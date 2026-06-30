const { requireSession, json } = require("../shared/auth");
const { calculateBid } = require("../shared/bidCalculator");
const { createWorkOrder } = require("../shared/workOrders");

module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;

  const body = req.body || {};
  if (!body.customerName || !body.customerName.trim()) {
    json(context, 400, { error: "customerName is required." });
    return;
  }
  if (!body.squareFootage || Number(body.squareFootage) <= 0) {
    json(context, 400, { error: "squareFootage must be a positive number." });
    return;
  }
  if (!Array.isArray(body.serviceTypes) || body.serviceTypes.length === 0) {
    json(context, 400, { error: "serviceTypes must be a non-empty array." });
    return;
  }

  try {
    const { lineItems, total } = calculateBid(body);
    const workOrder = await createWorkOrder(session.tid, {
      locationName: body.locationName || "",
      customerName: body.customerName.trim(),
      customerEmail: (body.customerEmail || "").trim(),
      squareFootage: Number(body.squareFootage),
      frequency: body.frequency,
      serviceTypes: body.serviceTypes,
      lineItems,
      total,
    });
    json(context, 201, workOrder);
  } catch (err) {
    context.log.error("CreateWorkOrder failed", err);
    json(context, 500, { error: String((err && err.message) || err) });
  }
};
