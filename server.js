import express from "express";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import path from "path";
import { mkdir, writeFile } from "fs/promises";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "15mb" }));

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ordersDir = path.resolve("pedidos");
const uploadsDir = path.join(ordersDir, "uploads");
const emailTo = process.env.EMAIL_TO || "diogotupi09@gmail.com";

const prices = {
  essencial: 4900,
  "mais-escolhido": 6900,
  premium: 7900,
};

const planNames = {
  essencial: "Essencial",
  "mais-escolhido": "Mais escolhido",
  premium: "Premium",
};

const imageExtensions = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
};

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getEmailTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    port: Number(process.env.EMAIL_PORT || 465),
    secure: process.env.EMAIL_SECURE !== "false",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function savePhoto(orderId, photo) {
  if (!photo || !photo.conteudo) {
    return null;
  }

  const extension = imageExtensions[photo.tipo];

  if (!extension) {
    throw new Error("invalid_photo_type");
  }

  await mkdir(uploadsDir, { recursive: true });

  const fileName = `${orderId}${extension}`;
  const filePath = path.join(uploadsDir, fileName);
  const buffer = Buffer.from(photo.conteudo, "base64");

  await writeFile(filePath, buffer);

  return {
    nomeOriginal: cleanText(photo.nome),
    tipo: photo.tipo,
    arquivo: path.relative(ordersDir, filePath),
  };
}

async function sendOrderEmail(order, checkoutUrl) {
  const transporter = getEmailTransporter();

  if (!transporter) {
    console.warn("E-mail não enviado: configure EMAIL_USER e EMAIL_PASS no .env.");
    return false;
  }

  const photoPath = order.foto ? path.join(ordersDir, order.foto.arquivo) : null;
  const attachments = photoPath
    ? [
      {
        filename: order.foto.nomeOriginal || path.basename(photoPath),
        path: photoPath,
        contentType: order.foto.tipo,
      },
    ]
    : [];

  const subject = `Novo pedido ${order.plano} - ${order.cliente.nome || order.id}`;
  const text = [
    "Novo pedido criado no Homenagem Musical",
    "",
    `ID: ${order.id}`,
    `Checkout Stripe: ${order.stripeSessionId}`,
    `Plano: ${order.plano}`,
    `Valor: R$ ${(order.valorCentavos / 100).toFixed(2).replace(".", ",")}`,
    "",
    `Nome: ${order.cliente.nome}`,
    `WhatsApp: ${order.cliente.whatsapp}`,
    `E-mail do cliente: ${order.cliente.email || "Não informado"}`,
    `Ocasião: ${order.detalhes.ocasiao}`,
    `Estilo: ${order.detalhes.estilo}`,
    "",
    "História:",
    order.detalhes.historia,
    "",
    `Checkout: ${checkoutUrl}`,
    order.foto ? `Foto anexada: ${order.foto.nomeOriginal}` : "Sem foto anexada.",
  ].join("\n");

  const html = `
    <h1>Novo pedido criado</h1>
    <p><strong>ID:</strong> ${escapeHtml(order.id)}</p>
    <p><strong>Checkout Stripe:</strong> ${escapeHtml(order.stripeSessionId)}</p>
    <p><strong>Plano:</strong> ${escapeHtml(order.plano)}</p>
    <p><strong>Valor:</strong> R$ ${(order.valorCentavos / 100).toFixed(2).replace(".", ",")}</p>
    <hr />
    <p><strong>Nome:</strong> ${escapeHtml(order.cliente.nome)}</p>
    <p><strong>WhatsApp:</strong> ${escapeHtml(order.cliente.whatsapp)}</p>
    <p><strong>E-mail do cliente:</strong> ${escapeHtml(order.cliente.email || "Não informado")}</p>
    <p><strong>Ocasião:</strong> ${escapeHtml(order.detalhes.ocasiao)}</p>
    <p><strong>Estilo:</strong> ${escapeHtml(order.detalhes.estilo)}</p>
    <p><strong>História:</strong></p>
    <p>${escapeHtml(order.detalhes.historia).replaceAll("\n", "<br />")}</p>
    <p><a href="${escapeHtml(checkoutUrl)}">Abrir checkout</a></p>
    <p>${order.foto ? "A foto foi enviada em anexo." : "Sem foto anexada."}</p>
  `;

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: emailTo,
      subject,
      text,
      html,
      attachments,
    });

    console.log("EMAIL ENVIADO:", info);
    return true;
  } catch (err) {
    console.error("ERRO REAL DO EMAIL:", err);
    import("fs").then(fs => fs.writeFileSync("email-error.log", err.stack || err.message || String(err)));
    return false;
  }
}

app.post("/create-checkout", async (req, res) => {
  const { nome, whatsapp, email, ocasiao, estilo, historia, pacote, foto } = req.body;

  if (!prices[pacote]) {
    return res.status(400).json({ error: "Plano inválido" });
  }

  try {
    await mkdir(ordersDir, { recursive: true });

    const orderId = randomUUID();
    const savedPhoto = await savePhoto(orderId, foto);
    const siteUrl = req.headers.origin || "http://localhost:3000";
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: `Pacote ${planNames[pacote]}`
            },
            unit_amount: prices[pacote]
          },
          quantity: 1
        }
      ],
      success_url: `${siteUrl}/sucesso.html`,
      cancel_url: `${siteUrl}/cancelado.html`,
      metadata: {
        orderId,
        nome: cleanText(nome),
        whatsapp: cleanText(whatsapp),
        email: cleanText(email),
        pacote,
      }
    });

    const order = {
      id: orderId,
      criadoEm: new Date().toISOString(),
      stripeSessionId: session.id,
      status: "checkout_criado",
      pacote,
      plano: planNames[pacote],
      valorCentavos: prices[pacote],
      cliente: {
        nome: cleanText(nome),
        whatsapp: cleanText(whatsapp),
        email: cleanText(email),
      },
      detalhes: {
        ocasiao: cleanText(ocasiao),
        estilo: cleanText(estilo),
        historia: cleanText(historia),
      },
      foto: savedPhoto,
    };

    await writeFile(
      path.join(ordersDir, `${orderId}.json`),
      JSON.stringify(order, null, 2),
      "utf8"
    );

    try {
      const emailSent = await sendOrderEmail(order, session.url);
      order.email = {
        enviado: emailSent,
        para: emailTo,
        enviadoEm: emailSent ? new Date().toISOString() : null,
      };

      await writeFile(
        path.join(ordersDir, `${orderId}.json`),
        JSON.stringify(order, null, 2),
        "utf8"
      );
    } catch (emailError) {
      console.error("Erro ao enviar e-mail do pedido:", emailError);
    }

    res.json({ url: session.url, orderId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar checkout" });
  }
});

app.use(express.static("."));

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});

