import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/utils";
import {
  type SalesTransaction,
  type PurchaseTransaction,
  type MonthlyAggregate,
  type DashboardSummary,
} from "../types/annual-sales.schema";

export function formatMonthLabel(year: number, month: number): string {
  return format(new Date(year, month - 1), "MMM");
}

export function aggregateMonthlyData(
  sales: SalesTransaction[],
  purchases: PurchaseTransaction[],
): MonthlyAggregate[] {
  const monthlyMap = new Map<string, { sales: number; purchases: number }>();

  for (const t of sales) {
    try {
      const date = parseISO(t.invoiceDate);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const entry = monthlyMap.get(key) ?? { sales: 0, purchases: 0 };
      entry.sales += t.totalInvoiceAmount;
      monthlyMap.set(key, entry);
    } catch {
      // skip invalid dates
    }
  }

  for (const t of purchases) {
    try {
      const date = parseISO(t.receiptDate);
      const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
      const entry = monthlyMap.get(key) ?? { sales: 0, purchases: 0 };
      entry.purchases += t.totalReceiptAmount;
      monthlyMap.set(key, entry);
    } catch {
      // skip invalid dates
    }
  }

  return Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => {
      const [year, month] = key.split("-").map(Number);
      const variance = values.sales - values.purchases;
      const total = values.sales + values.purchases;
      const biasPercentage = total > 0 ? (values.sales / total) * 100 : 0;

      return {
        month,
        year,
        monthLabel: formatMonthLabel(year, month),
        totalSales: values.sales,
        totalPurchases: values.purchases,
        variance,
        biasPercentage: Math.round(biasPercentage * 100) / 100,
      };
    });
}

export function calculateSummary(
  monthlyData: MonthlyAggregate[],
): DashboardSummary {
  const totalSales = monthlyData.reduce((sum, m) => sum + m.totalSales, 0);
  const totalPurchases = monthlyData.reduce(
    (sum, m) => sum + m.totalPurchases,
    0,
  );
  const netVariance = totalSales - totalPurchases;
  const total = totalSales + totalPurchases;
  const biasPercentage = total > 0 ? (totalSales / total) * 100 : 0;

  return {
    totalSales,
    totalPurchases,
    netVariance,
    biasPercentage: Math.round(biasPercentage * 100) / 100,
  };
}

export function filterSalesByCustomer(
  transactions: SalesTransaction[],
  customerName?: string,
): SalesTransaction[] {
  if (!customerName) return transactions;
  return transactions.filter((t) =>
    t.customerName.toLowerCase().includes(customerName.toLowerCase()),
  );
}

export function filterPurchasesBySupplier(
  transactions: PurchaseTransaction[],
  supplierName?: string,
): PurchaseTransaction[] {
  if (!supplierName) return transactions;
  return transactions.filter((t) =>
    t.supplierName.toLowerCase().includes(supplierName.toLowerCase()),
  );
}

export function formatCurrencyDisplay(
  value: number,
  maxLength: number = 15,
): string {
  const full = formatCurrency(value);
  if (full.length <= maxLength) return full;

  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return formatCurrency(Math.round(value / 1_000_000) * 1_000_000);
  }
  if (abs >= 1_000) {
    return formatCurrency(Math.round(value / 1_000) * 1_000);
  }
  return full;
}
