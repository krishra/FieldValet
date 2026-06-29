const { clearedCookie, json } = require("../shared/auth");

module.exports = async function (context, req) {
  json(context, 200, { success: true }, { "Set-Cookie": clearedCookie() });
};
