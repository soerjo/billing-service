import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Kafka, type Producer } from 'kafkajs';
import { OutboxStatus, type Prisma } from '@prisma/client';

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxService.name);
  private kafka?: Kafka;
  private producer?: Producer;
  private relayTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const kafkaEnabled =
      process.env.KAFKA_ENABLED?.toLowerCase() ??
      (process.env.NODE_ENV === 'production' ? 'true' : 'false');
    if (process.env.NODE_ENV === 'test' || kafkaEnabled !== 'true') {
      this.logger.log('Kafka relay disabled by KAFKA_ENABLED');
      return;
    }

    const brokers = this.configService.get<string>(
      'KAFKA_BROKERS',
      'kafka:29092',
    );
    const clientId = this.configService.get<string>(
      'KAFKA_CLIENT_ID',
      'billing-service',
    );

    try {
      this.kafka = new Kafka({
        clientId,
        brokers: brokers.split(',').map((b) => b.trim()),
      });
      this.producer = this.kafka.producer();
      await this.producer.connect();
      this.logger.log(`Connected to Kafka broker at ${brokers}`);
    } catch (err) {
      this.logger.warn(
        `Could not connect to Kafka at ${brokers} (${(err as Error).message}). Using fallback log relay.`,
      );
      this.producer = undefined;
    }

    // Start background relay loop every 5 seconds
    this.relayTimer = setInterval(() => {
      this.processPendingEvents().catch((err) => {
        this.logger.error('Error in outbox relay loop', err);
      });
    }, 5000);
    this.relayTimer.unref();
  }

  async onModuleDestroy() {
    clearInterval(this.relayTimer);
    if (this.producer) {
      await this.producer.disconnect().catch(() => {});
    }
  }

  async emit(
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payload: Record<string, unknown>,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx || this.prisma;
    this.logger.log(
      `Emit outbox event: [${aggregateType}] ${aggregateId} -> ${eventType}`,
    );

    return client.outboxEvent.create({
      data: {
        aggregateType,
        aggregateId,
        eventType,
        payload: payload as Prisma.InputJsonValue,
        status: OutboxStatus.PENDING,
      },
    });
  }

  private topicFor(eventType: string): string | null {
    switch (eventType) {
      case 'PAYMENT_COMPLETED':
      case 'PAYMENT_PAID':
        return 'billing.payment.completed';
      case 'PAYMENT_FAILED':
        return 'billing.payment.failed';
      default:
        return null;
    }
  }

  async processPendingEvents(): Promise<number> {
    const pendingEvents = await this.prisma.outboxEvent.findMany({
      where: { status: OutboxStatus.PENDING },
      take: 50,
      orderBy: { createdAt: 'asc' },
    });

    if (pendingEvents.length === 0) {
      return 0;
    }

    let processedCount = 0;

    for (const event of pendingEvents) {
      const topic = this.topicFor(event.eventType);

      try {
        if (topic && this.producer) {
          await this.producer.send({
            topic,
            messages: [
              {
                key: event.aggregateId,
                value: JSON.stringify({
                  eventId: event.id,
                  eventType: event.eventType,
                  sourceService: 'billing-service',
                  timestamp: new Date().toISOString(),
                  ...(event.payload as object),
                }),
              },
            ],
          });
          this.logger.log(
            `Published outbox event ${event.id} (${event.eventType}) to Kafka topic '${topic}'`,
          );
        } else {
          this.logger.log(
            `Log-relay fallback for outbox event ${event.id} (${event.eventType}) — no active Kafka producer.`,
          );
        }

        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            status: OutboxStatus.PROCESSED,
            processedAt: new Date(),
          },
        });

        processedCount += 1;
      } catch (err) {
        this.logger.error(
          `Failed to publish outbox event ${event.id}: ${(err as Error).message}`,
        );
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: OutboxStatus.FAILED },
        });
      }
    }

    return processedCount;
  }
}
