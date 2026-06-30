const { requireSession, json } = require("../shared/auth");
const { calculateBid } = require("../shared/bidCalculator");

module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;

  const body = req.body || {};
  if (!body.squareFootage || Number(body.squareFootage) <= 0) {
    json(context, 400, { error: "squareFootage must be a positive number." });
    return;
  }
  if (!Array.isArray(body.serviceTypes) || body.serviceTypes.length === 0) {
    json(context, 400, { error: "serviceTypes must be a non-empty array." });
    return;
  }

  json(context, 200, calculateBid(body));
};
