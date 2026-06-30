// FieldValet — placeholder bid calculator.
//
// Stand-in for the real pricing logic, which currently lives in an Excel sheet
// that hasn't been handed off yet. The output shape (lineItems + total) is the
// contract the QBO Estimate-creation code will consume next — swap the formula
// in calculateBid() for the real one later without touching any callers.

const SERVICE_TYPES = {
  dailyJanitorial: { label: "Daily Janitorial", ratePerSqFt: 0.08, flatFee: 0 },
  floorCare: { label: "Floor Care", ratePerSqFt: 0.03, flatFee: 75 },
  windowCleaning: { label: "Window Cleaning", ratePerSqFt: 0.015, flatFee: 50 },
  restroomService: { label: "Restroom Service", ratePerSqFt: 0.02, flatFee: 25 },
};

// Approximate visits/month, used to turn a per-visit price into a monthly line item.
const FREQUENCY_MULTIPLIERS = {
  daily: 22,
  weekly: 4.33,
  biweekly: 2,
  monthly: 1,
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function calculateBid(input) {
  const squareFootage = Number(input.squareFootage) || 0;
  const frequency = FREQUENCY_MULTIPLIERS[input.frequency] ? input.frequency : "monthly";
  const multiplier = FREQUENCY_MULTIPLIERS[frequency];
  const serviceTypes = Array.isArray(input.serviceTypes) ? input.serviceTypes : [];

  const lineItems = serviceTypes
    .filter((key) => SERVICE_TYPES[key])
    .map((key) => {
      const svc = SERVICE_TYPES[key];
      const perVisit = squareFootage * svc.ratePerSqFt + svc.flatFee;
      return {
        serviceType: key,
        description: `${svc.label} (${frequency})`,
        qty: multiplier,
        rate: svc.ratePerSqFt,
        amount: round2(perVisit * multiplier),
      };
    });

  const total = round2(lineItems.reduce((sum, li) => sum + li.amount, 0));

  return { lineItems, total };
}

module.exports = { SERVICE_TYPES, FREQUENCY_MULTIPLIERS, calculateBid };
