import express from "express";
import Stripe from "stripe";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { Resend } from "resend";
import path from "path";
import { mkdir, writeFile, readFile } from "fs/promises";
import fileUpload from "express-fileupload";


dotenv.config();

const app = express();
app.use(cors());
app.use(fileUpload());


// Webhook route must be before express.json() to receive raw body
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const orderId = session.metadata.orderId;

    try {
      const orderPath = path.join(ordersDir, `${orderId}.json`);
      const orderData = await readFile(orderPath, "utf8");
      const order = JSON.parse(orderData);

      // Update order status
      if (order.status === "pago") {
        return res.json({ received: true });
      }
      order.status = "pago";
      order.pagoEm = new Date().toISOString();

      // Send emails now that payment is confirmed
      console.log(`Pagamento confirmado para pedido ${orderId}. Enviando e-mails...`);
      const emailSent = await sendOrderEmail(order);
      await sendCustomerConfirmationEmail(order);

      order.email = {
        enviado: emailSent,
        para: emailTo,
        enviadoEm: emailSent ? new Date().toISOString() : null,
      };

      await writeFile(orderPath, JSON.stringify(order, null, 2), "utf8");
    } catch (err) {
      console.error("Erro ao processar webhook de sucesso:", err);
    }
  }

  res.json({ received: true });
});

app.use(express.json({ limit: "15mb" }));

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
if (!resend) {
  console.warn("AVISO: RESEND_API_KEY não encontrada. O envio de e-mails não funcionará.");
}
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const ordersDir = path.resolve("pedidos");
const uploadsDir = path.join(ordersDir, "uploads");
const emailTo = process.env.EMAIL_TO || "diogotupi09@gmail.com";
const deliveriesDataDir = path.join(ordersDir, "entregas");


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

async function sendCustomerConfirmationEmail(order) {
  if (!order.cliente.email) return false;

  const subject = `Obra em produção! ❤️ Recebemos seu pedido na Homenagem Musical`;

  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #16120f; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
      <div style="text-align: center; margin-bottom: 20px;">
         <div style="background: #b94f37; color: white; width: 40px; height: 40px; line-height: 40px; border-radius: 50%; display: inline-block; font-weight: bold; font-size: 20px; text-align: center;">H</div>
         <h2 style="margin-top: 10px;">Homenagem Musical</h2>
      </div>
      
      <h1 style="color: #b94f37; text-align: center;">Obrigado pelo seu pedido ❤️</h1>
      
      <p>Olá, <strong>${escapeHtml(order.cliente.nome)}</strong>!</p>
      
      <p>
        Recebemos o seu pedido na <strong>Homenagem Musical</strong>
        e o pagamento foi confirmado com sucesso.
      </p>

      <p>
        Agora vamos começar a produção da sua música personalizada com base
        nas informações que você nos enviou. Nossa equipe vai cuidar de cada detalhe para que o resultado seja emocionante.
      </p>

      <p style="font-size: 18px; font-weight: bold; text-align: center; color: #0f766e; margin: 30px 0;">
        Em breve você receberá sua homenagem pronta ❤️
      </p>

      <div style="background: #f4efe4; padding: 15px; border-radius: 8px; margin-top: 20px;">
        <p style="margin: 0; font-size: 14px;"><strong>Resumo do Pedido:</strong></p>
        <p style="margin: 5px 0 0; font-size: 14px;">Plano: ${escapeHtml(order.plano)}</p>
        <p style="margin: 2px 0 0; font-size: 14px;">ID: ${escapeHtml(order.id)}</p>
      </div>

      <p style="margin-top: 30px; text-align: center;">
        Obrigado por confiar na Homenagem Musical.<br>
        <strong>Equipe H.M</strong>
      </p>
    </div>
  `;

  try {
    if (!resend) {
      console.warn("Tentativa de enviar e-mail de confirmação sem chave API Resend.");
      return false;
    }
    const info = await resend.emails.send({
      from: "Homenagem Musical <contato@hmusical.com.br>",
      to: order.cliente.email,
      subject,
      html,
    });
    console.log("CONFIRMAÇÃO ENVIADA PARA O CLIENTE:", info);
    return true;
  } catch (err) {
    console.error("ERRO AO ENVIAR CONFIRMAÇÃO PARA CLIENTE:", err);
    return false;
  }
}

async function sendOrderEmail(order) {
  const subject = `[PAGO] Novo pedido ${order.plano} - ${order.cliente.nome || order.id}`;

  const html = `
    <h1>Pagamento Confirmado!</h1>
    <p>O cliente concluiu o pagamento do pedido abaixo.</p>
    <hr />
    <p><strong>ID:</strong> ${escapeHtml(order.id)}</p>
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
    <p>${order.foto ? "A foto foi enviada em anexo." : "Sem foto anexada."}</p>
  `;

  const attachments = [];
  if (order.foto) {
    const photoPath = path.join(ordersDir, order.foto.arquivo);
    try {
      // Read file as base64 for Resend
      const content = await readFile(photoPath, "base64");
      attachments.push({
        filename: order.foto.nomeOriginal || path.basename(photoPath),
        content: content,
      });
    } catch (e) {
      console.warn("Failed to read photo for email attachment:", e);
    }
  }

  try {
    if (!resend) {
      console.warn("Tentativa de enviar e-mail de pedido sem chave API Resend.");
      return false;
    }
    const info = await resend.emails.send({
      from: "Homenagem Musical <contato@hmusical.com.br>",
      to: emailTo,
      subject,
      html,
      attachments,
    });

    console.log("EMAIL ENVIADO APÓS PAGAMENTO:", info);
    return true;
  } catch (err) {
    console.error("ERRO REAL DO EMAIL NO WEBHOOK:", err);
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
    const siteUrl = req.headers.origin || "https://hmusical.com.br";
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      allow_promotion_codes: true,
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

    res.json({ url: session.url, orderId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar checkout" });
  }
});

// New Delivery Generation Endpoint (Saves JSON instead of HTML)
app.post("/api/generate-delivery", async (req, res) => {
  try {
    const { clientName, songTitle, lyrics, photoUrl, songNames, songUrls } = req.body;

    if (!clientName || !songTitle || !lyrics || !photoUrl || !songUrls) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    await mkdir(deliveriesDataDir, { recursive: true });

    const deliveryData = {
      clientName,
      songTitle,
      lyrics,
      photoUrl,
      songs: []
    };

    // Ensure they are arrays (express-fileupload handles multiple same-name fields as array)
    const urls = Array.isArray(songUrls) ? songUrls : [songUrls];
    const names = Array.isArray(songNames) ? songNames : [songNames];

    for (let i = 0; i < urls.length; i++) {
      if (urls[i] && urls[i].trim() !== "") {
        deliveryData.songs.push({
          url: urls[i],
          name: names[i] || `Versão ${i + 1}`
        });
      }
    }

    // Save JSON data
    const dataFilePath = path.join(deliveriesDataDir, `${clientName}.json`);
    await writeFile(dataFilePath, JSON.stringify(deliveryData, null, 2), "utf8");

    res.json({ success: true, url: `/entrega/${clientName}` });
  } catch (err) {
    console.error("Erro ao gerar entrega:", err);
    res.status(500).json({ error: "Erro interno ao gerar entrega" });
  }
});

// Dynamic Rendering Route
app.get("/entrega/:client", async (req, res) => {
  try {
    const client = req.params.client;
    const dataPath = path.join(deliveriesDataDir, `${client}.json`);

    // Read JSON data
    const dataRaw = await readFile(dataPath, "utf8");
    const data = JSON.parse(dataRaw);

    // Read Template
    let template = await readFile("entrega-template.html", "utf8");

    // Build Songs HTML
    let songsHtml = "";
    data.songs.forEach((song, i) => {
      songsHtml += `
        <div class="song-item">
            <div class="song-index">${i + 1}</div>
            <div class="song-details">
                <span class="song-name">${song.name}</span>
                <span class="song-artist">Homenagem Musical</span>
            </div>
            <button class="play-btn-small" onclick="playSong('${song.url}', '${song.name}')">
                <svg viewBox="0 0 24 24"><path d="M7 6v12l10-6z"></path></svg>
            </button>
            <a href="${song.url}" download class="download-link">Baixar</a>
        </div>
      `;
    });

    // Replace Placeholders
    template = template.replaceAll("[[PHOTO_URL]]", data.photoUrl);
    template = template.replaceAll("[[SONG_TITLE]]", data.songTitle);
    template = template.replaceAll("[[LYRICS]]", data.lyrics.replace(/\n/g, "<br>"));
    template = template.replaceAll("[[SONGS_HTML]]", songsHtml);

    res.send(template);
  } catch (err) {
    console.error("Erro ao renderizar entrega:", err);
    res.status(404).send("<h1>Página de entrega não encontrada</h1><p>Verifique o link ou entre em contato com o suporte.</p>");
  }
});

app.use("/uploads", express.static("uploads"));
app.use(express.static("."));


const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});
