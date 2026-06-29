const { requireSession, json } = require("../shared/auth");

module.exports = async function (context, req) {
  const session = requireSession(context, req);
  if (!session) return;

  json(context, 200, {
    fullName: session.name,
    email: session.email,
    tenantId: session.tid,
    role: session.role || "member",
  });
};
