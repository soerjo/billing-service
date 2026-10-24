import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SalesReportQueryDto } from './dto/sales-report-query.dto.js';
import { InvoiceStatus, Prisma } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSalesReport(query: SalesReportQueryDto) {
    const whereClause: Prisma.InvoiceWhereInput = {};

    if (query.organizationId) {
      whereClause.billingAccount = {
        organizationId: query.organizationId,
      };
    }

    if (query.startDate || query.endDate) {
      whereClause.createdAt = {};
      if (query.startDate) {
        whereClause.createdAt.gte = new Date(
          `${query.startDate}T00:00:00.000Z`,
        );
      }
      if (query.endDate) {
        whereClause.createdAt.lte = new Date(`${query.endDate}T23:59:59.999Z`);
      }
    }

    const invoices = await this.prisma.invoice.findMany({
      where: whereClause,
      include: {
        transactions: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    let grossRevenue = 0;
    let paidInvoicesCount = 0;
    const channelMap = new Map<
      string,
      { totalAmount: number; count: number }
    >();
    const trendMap = new Map<string, { revenue: number; count: number }>();

    for (const inv of invoices) {
      const amt = Number(inv.amount);
      grossRevenue += amt;

      const dateKey = inv.createdAt.toISOString().slice(0, 10);
      const existingTrend = trendMap.get(dateKey) || { revenue: 0, count: 0 };

      if (inv.status === InvoiceStatus.PAID) {
        paidInvoicesCount += 1;
        existingTrend.revenue += amt;
        existingTrend.count += 1;
        trendMap.set(dateKey, existingTrend);

        // Aggregate channel from successful transaction
        const lastTx = inv.transactions[inv.transactions.length - 1];
        const channel = lastTx?.channel || 'CASH';
        const chData = channelMap.get(channel) || { totalAmount: 0, count: 0 };
        chData.totalAmount += amt;
        chData.count += 1;
        channelMap.set(channel, chData);
      }
    }

    const totalInvoices = invoices.length;
    const netRevenue = Array.from(channelMap.values()).reduce(
      (acc, c) => acc + c.totalAmount,
      0,
    );
    const averageOrderValue =
      paidInvoicesCount > 0 ? Math.round(netRevenue / paidInvoicesCount) : 0;

    const paymentBreakdown = Array.from(channelMap.entries()).map(
      ([channel, data]) => ({
        channel,
        totalAmount: data.totalAmount,
        count: data.count,
      }),
    );

    const dailyTrend = Array.from(trendMap.entries()).map(([date, data]) => ({
      date,
      revenue: data.revenue,
      count: data.count,
    }));

    return {
      summary: {
        grossRevenue,
        netRevenue,
        totalInvoices,
        paidInvoices: paidInvoicesCount,
        averageOrderValue,
      },
      paymentBreakdown,
      dailyTrend,
    };
  }
}
