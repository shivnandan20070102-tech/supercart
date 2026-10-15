// SuperCart Order Receipt PDF generator (pdfkit — Render Free Tier safe).
// Puppeteer/Chrome yahan jaan-boojhkar NAHI use kiya: wo ~170MB+ download
// karta hai aur Render free par memory/timeout me fail hota hai.
// pdfkit pure-JS hai, cold-start par bhi ~1s me PDF deta hai.

// pdfkit 0.20 ESM entry (fontkit module.mjs) Node 22+/24 par directory-import
// me fail hota hai — CJS require se load karo (Render + local dono par stable).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// eslint-disable-next-line no-underscore-dangle
const _pdfkit = require('pdfkit');
const PDFDocument = _pdfkit?.default || _pdfkit;

const rs = (n) => `Rs. ${Number(n || 0).toFixed(2)}`;

// Har order ka PDF isi function se banta hai — order id/date/items/totals
// andar embed hote hain, isliye har invoice UNIQUE hota hai.
export const buildInvoicePdfBuffer = (invoice) =>
  new Promise((resolve, reject) => {
    try {
      // compress:false — chhoti receipt par size farak negligible, par text
      // PDF me searchable rehta hai (accounting/verification ke liye useful).
      const doc = new PDFDocument({ size: 'A4', margin: 48, compress: false });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const o = invoice || {};
      const items = Array.isArray(o.items) ? o.items : [];

      // ---- Header ----
      doc.font('Helvetica-Bold').fontSize(20).text('SuperCart - Order Receipt', { align: 'center' });
      doc.moveDown(0.2);
      doc.font('Helvetica').fontSize(9).fillColor('#666').text('(Order Receipt for your records)', { align: 'center' });
      doc.fillColor('#000');
      doc.moveDown(0.6);
      doc.fontSize(10).text(`Order Number: #${o.orderNumber ?? ''}`);
      doc.text(`Order Date: ${o.orderDate ?? ''}`);
      doc.text(`Store: ${o.storeName ?? 'SuperCart Store'}`);
      doc.moveDown(0.6);

      // ---- Customer ----
      doc.font('Helvetica-Bold').fontSize(12).text('Customer Details');
      doc.font('Helvetica').fontSize(10);
      doc.text(`Name: ${o.customerName || 'Customer'}`);
      doc.text(`Address: ${o.customerAddress || 'Address not available'}`);
      doc.text(`Phone: ${o.customerPhone || '-'}`);
      if (o.customerEmail) doc.text(`Email: ${o.customerEmail}`);
      doc.moveDown(0.8);

      // ---- Items table ----
      doc.font('Helvetica-Bold').fontSize(12).text('Items');
      doc.moveDown(0.3);
      const tableTop = doc.y;
      const colX = [48, 300, 360, 440];
      const rowH = 20;
      doc.fontSize(10);
      doc.text('Item', colX[0], tableTop);
      doc.text('Qty', colX[1], tableTop);
      doc.text('Price', colX[2], tableTop);
      doc.text('Total', colX[3], tableTop);
      doc.moveTo(48, tableTop + 14).lineTo(547, tableTop + 14).stroke();
      let y = tableTop + 22;
      doc.font('Helvetica');
      if (items.length === 0) {
        doc.text('No items found for this order.', colX[0], y);
        y += rowH;
      }
      for (const it of items) {
        if (y > 720) {
          doc.addPage();
          y = 60;
        }
        const name = String(it.name || 'Item').slice(0, 48);
        const qty = Number(it.quantity || 0);
        const price = Number(it.price || 0);
        doc.text(name, colX[0], y, { width: 240 });
        doc.text(String(qty), colX[1], y);
        doc.text(rs(price), colX[2], y);
        doc.text(rs(price * qty), colX[3], y);
        y += rowH;
      }
      doc.moveTo(48, y).lineTo(547, y).stroke();
      y += 12;
      doc.y = y;

      // ---- Totals ----
      const totalRow = (label, value, bold = false) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 13 : 10);
        doc.text(label, 300, doc.y, { width: 140 });
        doc.text(value, 440, doc.y - (bold ? 15 : 12), { width: 107, align: 'right' });
        doc.moveDown(bold ? 0.6 : 0.3);
      };
      totalRow('Items Total:', rs(o.itemsTotal));
      totalRow('Delivery Fee:', rs(o.deliveryFee));
      if (Number(o.tip || 0) > 0) totalRow('Tip:', rs(o.tip));
      if (Number(o.couponDiscount || 0) > 0) {
        totalRow(`Coupon Discount${o.couponCode ? ` (${o.couponCode})` : ''}:`, `- ${rs(o.couponDiscount)}`);
      }
      totalRow('GRAND TOTAL:', rs(o.grandTotal), true);
      doc.moveDown(0.5);

      // ---- Payment + footer ----
      doc.font('Helvetica').fontSize(10).text(`Payment Mode: ${o.paymentMode || 'Cash On Delivery'}`);
      doc.moveDown(1.2);
      doc.font('Helvetica-Bold').fontSize(12).text('Thank you for shopping with SuperCart!', { align: 'center' });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });

export default { buildInvoicePdfBuffer };
