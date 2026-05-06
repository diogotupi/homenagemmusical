export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  return response.status(501).json({
    error: "Vercel storage and Stripe checkout are not configured yet.",
  });
}
