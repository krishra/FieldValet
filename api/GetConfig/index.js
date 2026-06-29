module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: {
      azureMapsKey: process.env.AZURE_MAPS_KEY || "",
    },
  };
};
