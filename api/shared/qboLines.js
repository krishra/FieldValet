// FieldValet — builds QBO Estimate/Invoice Line entries from a work order's
// calculated line items, finding-or-creating a matching QBO Item per distinct
// description first. Shared by SubmitWorkOrder (Estimate) and CreateInvoice.
const { findOrCreateItem } = require("./qboItems");

// Fixed-price lines (Amount only, no Qty/UnitPrice): the bid calculator's
// qty/rate are internal pricing inputs (visits/month x $-per-sqft), not a
// literal unit price — QBO requires Amount === UnitPrice * Qty when both are
// present, which those values don't satisfy.
async function buildLineItems(tenantId, lineItems) {
  const incomeAccountId = process.env.QBO_INCOME_ACCOUNT_ID;
  const itemCache = new Map();

  const lines = [];
  for (const li of lineItems) {
    if (!itemCache.has(li.description)) {
      const item = await findOrCreateItem(tenantId, { name: li.description, incomeAccountId });
      itemCache.set(li.description, item);
    }
    const item = itemCache.get(li.description);
    lines.push({
      DetailType: "SalesItemLineDetail",
      Amount: li.amount,
      Description: li.description,
      SalesItemLineDetail: {
        ItemRef: { value: item.Id, name: item.Name },
      },
    });
  }
  return lines;
}

module.exports = { buildLineItems };
