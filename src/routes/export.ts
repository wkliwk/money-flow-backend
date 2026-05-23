import { Router } from 'express';
import PDFDocument from 'pdfkit';
import ExpenseModel from '../models/Expense';
import { PAYMENT_METHODS } from '../models/Expense';
import { protect, AuthRequest } from '../middleware/auth';

const router = Router();

router.use(protect);

interface ExpenseRecord {
  date?: string | Date;
  createdAt?: string | Date;
  description?: string;
  category?: string;
  type?: string;
  amount?: number;
  currency?: string;
  originalAmount?: number;
  exchangeRate?: number;
  paymentMethod?: string;
  participants?: string[];
  item?: string;
}

/**
 * Build a Mongoose filter from shared query params.
 * Supports: from, to, type, category, q, paymentMethod, minAmount, maxAmount
 */
function buildExportFilter(
  userId: string,
  query: Record<string, string | undefined>
): Record<string, unknown> {
  const filter: Record<string, unknown> = { owner: userId };

  const { from, to, type, category, q, paymentMethod, minAmount, maxAmount } = query;

  // Date range
  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      dateFilter.$lte = toDate;
    }
    filter.date = dateFilter;
  }

  // Type filter
  if (type) filter.type = type;

  // Category filter (exact match)
  if (category) filter.category = category;

  // Payment method filter
  if (paymentMethod) {
    if (PAYMENT_METHODS.includes(paymentMethod as typeof PAYMENT_METHODS[number])) {
      filter.paymentMethod = paymentMethod;
    }
  }

  // Amount range
  const minAmt = parseFloat(minAmount || '');
  const maxAmt = parseFloat(maxAmount || '');
  if (!isNaN(minAmt) || !isNaN(maxAmt)) {
    const amountFilter: Record<string, number> = {};
    if (!isNaN(minAmt)) amountFilter.$gte = minAmt;
    if (!isNaN(maxAmt)) amountFilter.$lte = maxAmt;
    filter.amount = amountFilter;
  }

  // Text search
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = { $regex: escaped, $options: 'i' };
    filter.$or = [
      { description: regex },
      { category: regex },
      { item: regex },
      { participants: regex },
    ];
  }

  return filter;
}

function formatDate(raw: string | Date | undefined): string {
  if (!raw) return '';
  return new Date(raw).toISOString().split('T')[0];
}

function escapeCSVCell(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// GET /api/export/csv
router.get('/csv', async (req: AuthRequest, res) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const filter = buildExportFilter(req.userId || '', query);

    const expenses = await ExpenseModel.find(filter)
      .sort({ date: -1 })
      .lean();

    const headers = [
      'Date', 'Description', 'Category', 'Type',
      'Amount (HKD)', 'Currency', 'Original Amount', 'Exchange Rate',
      'Payment Method', 'Participants',
    ];

    const rows = (expenses as ExpenseRecord[]).map((e) => [
      formatDate(e.date || e.createdAt),
      e.description || '',
      e.category || '',
      e.type || '',
      String(e.amount || 0),
      e.currency || 'HKD',
      e.originalAmount != null ? String(e.originalAmount) : '',
      e.exchangeRate != null ? String(e.exchangeRate) : '',
      e.paymentMethod || '',
      e.participants?.join(';') || '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => escapeCSVCell(String(cell))).join(','))
      .join('\n');

    const filename = `money-flow-export-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error('GET /api/export/csv failed:', err);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

// GET /api/export/pdf
router.get('/pdf', async (req: AuthRequest, res) => {
  try {
    const query = req.query as Record<string, string | undefined>;
    const filter = buildExportFilter(req.userId || '', query);

    const expenses = await ExpenseModel.find(filter)
      .sort({ date: -1 })
      .lean() as ExpenseRecord[];

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    const filename = `money-flow-export-${new Date().toISOString().split('T')[0]}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Header
    doc.fontSize(18).text('Money Flow - Transaction Report', { align: 'center' });
    doc.moveDown(0.3);

    // Date range subtitle
    const fromDate = query.from || '';
    const toDate = query.to || '';
    if (fromDate || toDate) {
      const rangeText = fromDate && toDate
        ? `${fromDate} to ${toDate}`
        : fromDate
          ? `From ${fromDate}`
          : `Up to ${toDate}`;
      doc.fontSize(10).text(rangeText, { align: 'center' });
    }
    doc.fontSize(10).text(`Generated: ${new Date().toISOString().split('T')[0]}`, { align: 'center' });
    doc.moveDown(1);

    if (expenses.length === 0) {
      doc.fontSize(12).text('No transactions found for the selected filters.', { align: 'center' });
      doc.end();
      return;
    }

    // Transaction table
    const colWidths = [65, 140, 75, 60, 70, 55, 50];
    const colHeaders = ['Date', 'Description', 'Category', 'Type', 'Amount', 'Currency', 'Method'];
    const tableLeft = 40;
    const rowHeight = 18;

    function drawTableHeader(yPos: number): number {
      doc.fontSize(8).font('Helvetica-Bold');
      let x = tableLeft;
      for (let i = 0; i < colHeaders.length; i++) {
        doc.text(colHeaders[i], x, yPos, { width: colWidths[i], align: 'left' });
        x += colWidths[i];
      }
      const lineY = yPos + rowHeight - 4;
      doc.moveTo(tableLeft, lineY)
        .lineTo(tableLeft + colWidths.reduce((a, b) => a + b, 0), lineY)
        .stroke();
      return lineY + 4;
    }

    let y = drawTableHeader(doc.y);
    doc.font('Helvetica').fontSize(7);

    for (const expense of expenses) {
      if (y > 750) {
        doc.addPage();
        y = drawTableHeader(40);
        doc.font('Helvetica').fontSize(7);
      }

      const cells = [
        formatDate(expense.date || expense.createdAt),
        (expense.description || '').substring(0, 30),
        (expense.category || '').substring(0, 15),
        expense.type || '',
        String(expense.amount || 0),
        expense.currency || 'HKD',
        expense.paymentMethod || '',
      ];

      let x = tableLeft;
      for (let i = 0; i < cells.length; i++) {
        doc.text(cells[i], x, y, { width: colWidths[i], align: 'left' });
        x += colWidths[i];
      }
      y += rowHeight;
    }

    // Category summary section
    doc.addPage();
    doc.fontSize(14).font('Helvetica-Bold').text('Category Summary', { align: 'center' });
    doc.moveDown(1);

    const categoryTotals = new Map<string, { total: number; count: number }>();
    let grandTotal = 0;

    for (const expense of expenses) {
      const cat = expense.category || 'Uncategorised';
      const amt = expense.amount || 0;
      const existing = categoryTotals.get(cat) || { total: 0, count: 0 };
      existing.total += amt;
      existing.count += 1;
      categoryTotals.set(cat, existing);
      grandTotal += amt;
    }

    const sortedCategories = Array.from(categoryTotals.entries())
      .sort(([, a], [, b]) => b.total - a.total);

    doc.font('Helvetica-Bold').fontSize(9);
    const summaryColWidths = [180, 100, 80, 80];
    let sx = tableLeft;
    const summaryHeaders = ['Category', 'Total', 'Transactions', '% of Total'];
    for (let i = 0; i < summaryHeaders.length; i++) {
      doc.text(summaryHeaders[i], sx, doc.y, { width: summaryColWidths[i], align: 'left', continued: i < summaryHeaders.length - 1 });
      sx += summaryColWidths[i];
    }
    doc.text('');
    const summaryLineY = doc.y + 2;
    doc.moveTo(tableLeft, summaryLineY)
      .lineTo(tableLeft + summaryColWidths.reduce((a, b) => a + b, 0), summaryLineY)
      .stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(8);
    for (const [category, data] of sortedCategories) {
      const pct = grandTotal > 0 ? ((data.total / grandTotal) * 100).toFixed(1) : '0.0';
      sx = tableLeft;
      const vals = [category, data.total.toFixed(2), String(data.count), `${pct}%`];
      for (let i = 0; i < vals.length; i++) {
        doc.text(vals[i], sx, doc.y, { width: summaryColWidths[i], align: 'left', continued: i < vals.length - 1 });
        sx += summaryColWidths[i];
      }
      doc.text('');
    }

    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(9);
    doc.text(`Total: ${grandTotal.toFixed(2)}    |    ${expenses.length} transactions`);

    doc.end();
  } catch {
    // If headers already sent, we can't send JSON error
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to export PDF' });
    }
  }
});

export default router;
