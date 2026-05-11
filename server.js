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
app.set("trust proxy", 1);
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
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
if (!stripe) {
  console.warn("AVISO: STRIPE_SECRET_KEY não encontrada. O checkout não funcionará.");
}
const ordersDir = path.resolve("pedidos");
const uploadsDir = path.join(ordersDir, "uploads");
const emailTo = process.env.EMAIL_TO || "diogotupi09@gmail.com";
const deliveriesDataDir = path.join(ordersDir, "entregas");
const instantSongsDir = path.join(ordersDir, "instant-songs");
const instantGenIpCountsPath = path.join(ordersDir, "instant-gen-ip-counts.json");
const instantGenLimitParsed = Number.parseInt(process.env.INSTANT_FREE_GEN_LIMIT ?? "3", 10);
const INSTANT_GEN_LIMIT_IP =
  Number.isFinite(instantGenLimitParsed) && instantGenLimitParsed > 0 ? instantGenLimitParsed : 3;
const instantGenWindowHoursParsed = Number.parseFloat(process.env.INSTANT_GEN_IP_WINDOW_HOURS ?? "2");
const INSTANT_GEN_IP_WINDOW_MS =
  Number.isFinite(instantGenWindowHoursParsed) && instantGenWindowHoursParsed > 0
    ? instantGenWindowHoursParsed * 60 * 60 * 1000
    : 2 * 60 * 60 * 1000;

const prices = {
  essencial: 1900,
  "mais-escolhido": 6900,
  premium: 7900,
};

const planNames = {
  essencial: "Essencial (Instantâneo)",
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

async function saveInstantSongRecord(songId, payload) {
  await mkdir(instantSongsDir, { recursive: true });
  await writeFile(
    path.join(instantSongsDir, `${songId}.json`),
    JSON.stringify(payload, null, 2),
    "utf8"
  );
}

async function loadInstantSongRecord(songId) {
  try {
    const raw = await readFile(path.join(instantSongsDir, `${songId}.json`), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function instantTitleFromHistoria(historia) {
  const line = cleanText(historia).split(/\n/u)[0] || "Sua música";
  return line.length > 100 ? `${line.slice(0, 97)}…` : line;
}

function normalizeClientIp(raw) {
  if (!raw || typeof raw !== "string") return "unknown";
  const t = raw.trim();
  if (t.startsWith("::ffff:")) return t.slice(7).trim();
  return t;
}

/** HTML do segundo link de download (imagem da letra), só se `photoUrlB` for URL http(s). */
function deliverySecondPhotoDownloadHtml(photoUrlB) {
  const b = cleanText(photoUrlB || "");
  if (!b || (!b.startsWith("http://") && !b.startsWith("https://"))) return "";
  const href = b.replace(/"/g, "&quot;");
  return `
                        <a href="${href}" download="homenagem_letra.png" class="dl-asset dl-asset--lyrics" title="Baixar imagem da letra">
                                <svg class="dl-asset__icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                <span>letra</span>
                            </a>`;
}

/** IP do pedido HTTP (honra proxy com trust proxy já ativado). */
function getInstantRequestIp(req) {
  const xffRaw = req.headers?.["x-forwarded-for"];
  const xff = typeof xffRaw === "string" ? xffRaw.split(",")[0] : "";
  const fromSocket = normalizeClientIp(req.socket?.remoteAddress || "");
  const fromForwarded = normalizeClientIp(xff);
  return fromForwarded || fromSocket || "unknown";
}

/** Prévias grátis por IP: só contam gerações dentro da janela (ex.: últimas 2 horas). */
function pruneInstantGenerationsByIp(byIp, now = Date.now()) {
  /** @type {Record<string, number[]>} */
  const out = {};
  if (!byIp || typeof byIp !== "object") return out;
  for (const [k, arr] of Object.entries(byIp)) {
    if (!Array.isArray(arr)) continue;
    const fresh = arr.filter((t) => typeof t === "number" && now - t < INSTANT_GEN_IP_WINDOW_MS);
    if (fresh.length) out[k] = fresh;
  }
  return out;
}

async function readInstantGenerationEventsByIp() {
  try {
    const raw = await readFile(instantGenIpCountsPath, "utf8");
    const j = JSON.parse(raw);
    if (j?.byIp && typeof j.byIp === "object") {
      return pruneInstantGenerationsByIp(j.byIp);
    }
    return {};
  } catch {
    return {};
  }
}

async function appendInstantGenerationForIp(ip) {
  await mkdir(ordersDir, { recursive: true });
  const now = Date.now();
  const byIp = await readInstantGenerationEventsByIp();
  const list = [...(byIp[ip] || []), now].filter((t) => now - t < INSTANT_GEN_IP_WINDOW_MS);
  byIp[ip] = list;
  await writeFile(instantGenIpCountsPath, JSON.stringify({ byIp }, null, 2), "utf8");
}

/** Faixas em `response.sunoData[]`: `audioUrl` / snake_case compat. */
function sunoTracksFromPayload(data) {
  const resp = data?.response;
  const list =
    Array.isArray(resp?.sunoData)
      ? resp.sunoData
      : Array.isArray(resp?.data)
        ? resp.data
        : [];
  /** @type {{ audioUrl: string, title: string }[]} */
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const url =
      typeof item.audioUrl === "string" && item.audioUrl.trim()
        ? item.audioUrl.trim()
        : typeof item.audio_url === "string" && item.audio_url.trim()
          ? item.audio_url.trim()
          : typeof item.streamAudioUrl === "string" && item.streamAudioUrl.trim()
            ? item.streamAudioUrl.trim()
            : "";
    if (!url) continue;
    out.push({
      audioUrl: url,
      title: typeof item.title === "string" ? cleanText(item.title) : "",
    });
  }
  return out.slice(0, 2);
}

/** No modo não-custom, até 2 faixas por tarefa. Esperamos SUCCESS para recuperar todas. */
const SUNO_SIMPLE_PROMPT_MAX = 500;

async function pollSunoUntilSuccessTracks(taskId, apiKey) {
  const base = cleanText(process.env.SUNO_API_BASE) || "https://api.sunoapi.org";
  const maxMs = 8 * 60 * 1000;
  const start = Date.now();
  const headers = { Authorization: `Bearer ${apiKey}` };

  const failStatuses = new Set([
    "FAILED",
    "ERROR",
    "CREATE_TASK_FAILED",
    "GENERATE_AUDIO_FAILED",
    "CALLBACK_EXCEPTION",
    "SENSITIVE_WORD_ERROR",
  ]);

  while (Date.now() - start < maxMs) {
    await new Promise((r) => setTimeout(r, 6000));
    const resp = await fetch(
      `${base}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
      { headers },
    );
    const json = await resp.json();
    if (json.code !== 200) {
      throw new Error(json.msg || "suno_status_error");
    }
    const payload = json.data;
    const status = payload?.status;

    if (failStatuses.has(status)) {
      throw new Error(
        `suno_failed:${status}:${payload?.errorMessage || payload?.errorCode || ""}`,
      );
    }

    if (status === "SUCCESS") {
      const tracks = sunoTracksFromPayload(payload);
      if (!tracks.length) {
        console.warn("[Suno] SUCCESS sem faixas; response keys:", payload?.response && Object.keys(payload.response));
        throw new Error("suno_no_audio");
      }
      return tracks;
    }
  }

  throw new Error("suno_timeout");
}

async function generateWithSuno(descricaoCliente) {
  const apiKey = cleanText(process.env.SUNO_API_KEY);
  if (!apiKey) return null;

  const base = cleanText(process.env.SUNO_API_BASE) || "https://api.sunoapi.org";
  const callBackUrl =
    cleanText(process.env.SUNO_CALLBACK_URL) ||
    `${cleanText(process.env.PUBLIC_SITE_URL) || "https://hmusical.com.br"}/api/suno-callback-ignore`;
  /** V5_5 conforme lista da API (_ não ponto na string do modelo). */
  const model = cleanText(process.env.SUNO_MODEL) || "V5_5";
  const prompt = cleanText(descricaoCliente).slice(0, SUNO_SIMPLE_PROMPT_MAX);

  /*
   * customMode DESLIGADO: a documentação diz que a letra é gerada pela IA com base na ideia,
   * e não cantada literalmente como acontecia em customMode (prompt = letra fixa).
   * Limite 500 caracteres exigido nesse modo.
   */
  const genResp = await fetch(`${base}/api/v1/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      customMode: false,
      instrumental: false,
      model,
      callBackUrl,
    }),
  });

  const genJson = await genResp.json();
  if (genJson.code !== 200 || !genJson.data?.taskId) {
    throw new Error(genJson.msg || "suno_generate_failed");
  }

  const tracks = await pollSunoUntilSuccessTracks(genJson.data.taskId, apiKey);
  const fallbackTitle = instantTitleFromHistoria(descricaoCliente).slice(0, 100);
  return tracks.map((t, i) => ({
    audioUrl: t.audioUrl,
    title: cleanText(t.title) || `${fallbackTitle} · v${i + 1}`,
  }));
}

function escapeHtml(value) {
  return cleanText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safePublicHttpUrl(raw) {
  if (typeof raw !== "string") return "";
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* URL inválida */
  }
  return "";
}

function getExpirationDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  const day = date.getDate();
  const monthNames = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day} de ${month} de ${year}`;
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
  const isInstant = order.tipoPedido === "instantaneo" && order.instantSong?.fullUrl;

  const subject = isInstant
    ? `Download liberado! 🎵 Sua música está pronta — Homenagem Musical`
    : `Obra em produção! ❤️ Recebemos seu pedido na Homenagem Musical`;

  if (isInstant) {
    if (/^pendente@/iu.test(order.cliente.email || "")) {
      return false;
    }
    const dl = safePublicHttpUrl(order.instantSong.fullUrl);
    const dl2 = safePublicHttpUrl(order.instantSong.fullUrlB || "");
    if (!dl) return false;
    const secondBtn =
      dl2 && dl2 !== dl
        ? `
      <p style="text-align:center; margin: 12px 0 0;">
        <a href="${escapeHtml(dl2)}" style="display:inline-block; background:#0f766e; color:#fff; padding:15px 25px; text-decoration:none; border-radius:8px; font-weight:bold;">
          Baixar Versão 2 (MP3)
        </a>
      </p>`
        : "";
    const htmlInstant = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #16120f; max-width: 600px; margin: 0 auto; border: 1px solid #eee; padding: 20px; border-radius: 10px;">
      <div style="text-align: center; margin-bottom: 20px;">
         <div style="background: #b94f37; color: white; width: 40px; height: 40px; line-height: 40px; border-radius: 50%; display: inline-block; font-weight: bold; font-size: 20px;">H</div>
         <h2 style="margin-top: 10px;">Homenagem Musical</h2>
      </div>
      <h1 style="color: #b94f37; text-align: center;">Obrigado pela compra! ❤️</h1>
      <p>Olá, <strong>${escapeHtml(order.cliente.nome)}</strong>!</p>
      <p>O pagamento foi confirmado. Seu pacote inclui as duas versões geradas. Use o mesmo link da página após o checkout ou baixe abaixo.</p>
      <p style="text-align:center; margin: 28px 0 0;">
        <a href="${escapeHtml(dl)}" style="display:inline-block; background:#b94f37; color:#fff; padding:15px 25px; text-decoration:none; border-radius:8px; font-weight:bold;">
          Baixar Versão 1 (MP3)
        </a>
      </p>${secondBtn}
      <p style="font-size: 13px; color: #555;">Guarde os arquivos no seu celular ou computador. Os provedores externos podem expirar links após algum tempo.</p>
    </div>`;
    try {
      if (!resend) return false;
      const info = await resend.emails.send({
        from: "Homenagem Musical <noreply@hmusical.com.br>",
        to: order.cliente.email,
        subject,
        html: htmlInstant,
      });
      console.log("CONFIRMAÇÃO INSTANTÂNEO:", info);
      return true;
    } catch (err) {
      console.error("Erro ao enviar confirmação instantânea:", err);
      return false;
    }
  }

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
      from: "Homenagem Musical <noreply@hmusical.com.br>",
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
    ${
      order.instantSong?.fullUrl
        ? `<p><strong>Versão 1 (MP3):</strong> ${escapeHtml(safePublicHttpUrl(order.instantSong.fullUrl) ? order.instantSong.fullUrl : "URL inválida")}</p>`
        : ""
    }
    ${
      order.instantSong?.fullUrlB
        ? `<p><strong>Versão 2 (MP3):</strong> ${escapeHtml(safePublicHttpUrl(order.instantSong.fullUrlB) ? order.instantSong.fullUrlB : "")}</p>`
        : ""
    }
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
      from: "Homenagem Musical <noreply@hmusical.com.br>",
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
      success_url: req.body.redirectUrl || `${siteUrl}/sucesso.html`,
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

/** Checkout apenas para fluxo instantâneo (gerador IA + R$ 19); exige música já gerada no servidor */
app.post("/create-checkout-session", async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: "Pagamentos indisponíveis." });
  }

  const plan = cleanText(req.body?.plan);
  const clientData = req.body?.clientData || {};
  const redirectUrlRaw = cleanText(req.body?.redirectUrl);
  const instantSong = req.body?.instantSong || {};

  if (plan !== "essencial") {
    return res.status(400).json({ error: "Plano inválido para esta sessão." });
  }

  const songId = cleanText(instantSong.songId);
  const fullUrlPassed = safePublicHttpUrl(instantSong.fullUrl);
  const fullUrlPassedB = safePublicHttpUrl(instantSong.fullUrlB);
  if (!songId || !fullUrlPassed) {
    return res.status(400).json({ error: "Dados da música incompletos. Gere uma preview primeiro." });
  }

  const disk = await loadInstantSongRecord(songId);
  const diskU0 =
    disk?.tracks?.[0]?.audioUrl && safePublicHttpUrl(disk.tracks[0].audioUrl)
      ? disk.tracks[0].audioUrl
      : safePublicHttpUrl(disk?.fullUrl)
        ? disk.fullUrl
        : "";
  const diskU1 =
    disk?.tracks?.[1]?.audioUrl && safePublicHttpUrl(disk.tracks[1].audioUrl)
      ? disk.tracks[1].audioUrl
      : safePublicHttpUrl(disk?.fullUrlB ?? "")
        ? disk.fullUrlB
        : null;

  if (!diskU0) {
    return res.status(400).json({ error: "Música não encontrada no servidor. Gere a preview novamente." });
  }
  if (safePublicHttpUrl(diskU0) !== fullUrlPassed) {
    return res.status(400).json({ error: "A preview não confere com o servidor. Atualize a página e gere de novo." });
  }
  if (diskU1) {
    if (!fullUrlPassedB) {
      return res.status(400).json({ error: "Falta dados da segunda versão. Recarregue e gere novamente." });
    }
    if (safePublicHttpUrl(diskU1) !== fullUrlPassedB) {
      return res.status(400).json({ error: "A segunda faixa não confere com o servidor. Gere de novo." });
    }
  }

  const resolvedFullUrl = diskU0;
  const resolvedSecondUrl = diskU1 || null;
  const titleFromDisk = cleanText(disk.title);

  const pacote = "essencial";

  try {
    await mkdir(ordersDir, { recursive: true });

    const orderId = randomUUID();
    const originBase = (
      req.headers.origin ||
      cleanText(process.env.PUBLIC_SITE_URL) ||
      "http://localhost:3000"
    ).replace(/\/$/, "");

    let successTarget = redirectUrlRaw;
    if (!successTarget) {
      return res.status(400).json({ error: "URL de retorno obrigatória." });
    }
    if (!/^https?:\/\//iu.test(successTarget)) {
      successTarget = successTarget.startsWith("/")
        ? `${originBase}${successTarget}`
        : `${originBase}/${successTarget}`;
    }
    const successUrl = successTarget.includes("?")
      ? `${successTarget}&session_id={CHECKOUT_SESSION_ID}`
      : `${successTarget}?session_id={CHECKOUT_SESSION_ID}`;
    const cancelTarget = `${originBase}/cancelado.html`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      allow_promotion_codes: true,
      line_items: [
        {
          price_data: {
            currency: "brl",
            product_data: {
              name: `${planNames[pacote]}${
                resolvedSecondUrl && resolvedSecondUrl !== resolvedFullUrl
                  ? ` · 2 versões MP3`
                  : ` · MP3`
              }`,
            },
            unit_amount: prices[pacote],
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelTarget,
      metadata: { orderId },
    });

    const order = {
      id: orderId,
      criadoEm: new Date().toISOString(),
      stripeSessionId: session.id,
      status: "checkout_criado",
      tipoPedido: "instantaneo",
      pacote,
      plano: planNames[pacote],
      valorCentavos: prices[pacote],
      cliente: {
        nome: cleanText(clientData.nome),
        whatsapp: cleanText(clientData.whatsapp),
        email: cleanText(clientData.email),
      },
      detalhes: {
        ocasiao: cleanText(clientData.ocasiao),
        estilo: cleanText(clientData.estilo),
        historia: cleanText(clientData.historia),
      },
      foto: null,
      instantSong: {
        songId,
        fullUrl: resolvedFullUrl,
        fullUrlB: resolvedSecondUrl,
        tracks:
          disk.tracks?.length
            ? disk.tracks.map((row) => ({
                label: cleanText(row.label) || "Versão",
                audioUrl: safePublicHttpUrl(row.audioUrl) ? row.audioUrl : "",
                title: cleanText(row.title || ""),
              }))
            : [
                {
                  label: "Versão 1",
                  audioUrl: resolvedFullUrl,
                  title: titleFromDisk,
                },
                ...(resolvedSecondUrl
                  ? [
                      {
                        label: "Versão 2",
                        audioUrl: resolvedSecondUrl,
                        title: titleFromDisk,
                      },
                    ]
                  : []),
              ],
        title:
          titleFromDisk ||
          cleanText(instantSong.title) ||
          instantTitleFromHistoria(clientData.historia || ""),
      },
    };

    await writeFile(
      path.join(ordersDir, `${orderId}.json`),
      JSON.stringify(order, null, 2),
      "utf8",
    );

    res.json({ url: session.url, orderId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar sessão de pagamento." });
  }
});

app.get("/api/instant-paid-download", async (req, res) => {
  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id.trim() : "";
  if (!sessionId || !stripe) {
    return res.status(400).json({ error: "Sessão inválida." });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(403).json({ error: "Pagamento ainda não confirmado." });
    }

    const orderId = typeof session.metadata?.orderId === "string" ? session.metadata.orderId : "";
    if (!orderId) {
      return res.status(404).json({ error: "Pedido não encontrado." });
    }

    const orderPath = path.join(ordersDir, `${orderId}.json`);
    const orderRaw = await readFile(orderPath, "utf8");
    const order = JSON.parse(orderRaw);

    const songId = cleanText(order?.instantSong?.songId);

    let title =
      cleanText(order?.instantSong?.title) || instantTitleFromHistoria(order?.detalhes?.historia || "");

    const fromDisk = songId ? await loadInstantSongRecord(songId) : null;
    if (fromDisk?.title) title = cleanText(fromDisk.title);

    /** @type {{ label: string, url: string, title?: string }[]} */
    const tracksOut = [];
    const diskOrOrderTracks = Array.isArray(fromDisk?.tracks)
      ? fromDisk.tracks
      : Array.isArray(order?.instantSong?.tracks)
        ? order.instantSong.tracks
        : [];
    for (const row of diskOrOrderTracks) {
      const url = safePublicHttpUrl(row?.audioUrl);
      if (!url) continue;
      tracksOut.push({
        label: cleanText(row.label) || `Versão ${tracksOut.length + 1}`,
        url,
        title: cleanText(row.title || ""),
      });
    }
    if (!tracksOut.length) {
      const u0 =
        safePublicHttpUrl(fromDisk?.fullUrl) || safePublicHttpUrl(order?.instantSong?.fullUrl);
      const u1 =
        safePublicHttpUrl(fromDisk?.fullUrlB) || safePublicHttpUrl(order?.instantSong?.fullUrlB || "");
      if (u0) tracksOut.push({ label: "Versão 1", url: u0, title });
      if (u1 && u1 !== u0) tracksOut.push({ label: "Versão 2", url: u1, title });
    }

    const primaryUrl = tracksOut[0]?.url;
    if (!primaryUrl) {
      return res.status(404).json({ error: "Arquivo não disponível." });
    }

    const secondaryUrl = tracksOut[1]?.url || null;

    res.json({
      success: true,
      fullUrl: primaryUrl,
      fullUrlB: secondaryUrl,
      tracks: tracksOut,
      title,
      songId: songId || null,
    });
  } catch (err) {
    console.error("instant-paid-download:", err);
    res.status(500).json({ error: "Não foi possível validar o pagamento." });
  }
});

// New Delivery Generation Endpoint (Saves JSON instead of HTML)
app.post("/api/generate-delivery", async (req, res) => {
  try {
    const { clientName, songTitle, lyrics, photoUrl, photoUrlB, songNames, songUrls } = req.body;

    if (!clientName || !songTitle || !lyrics || !songUrls) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    await mkdir(deliveriesDataDir, { recursive: true });

    const deliveryData = {
      clientName,
      songTitle,
      lyrics,
      photoUrl,
      photoUrlB: photoUrlB || '',
      expirationDate: getExpirationDate(),
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

async function persistInstantSongRecord(songId, historia, trackList) {
  const t0 = trackList[0];
  const t1 = trackList[1];
  await saveInstantSongRecord(songId, {
    songId,
    historia: cleanText(historia),
    criadoEm: new Date().toISOString(),
    tracks: trackList.map((t, i) => ({
      label: `Versão ${i + 1}`,
      audioUrl: t.audioUrl,
      title: t.title,
    })),
    fullUrl: t0?.audioUrl,
    fullUrlB: t1?.audioUrl ?? null,
    title: t0?.title || instantTitleFromHistoria(historia),
  });
}

// Opcional: o Suno (sunoapi.org) pode disparar webhook — respondemos para evitar timeouts do lado deles
app.all("/api/suno-callback-ignore", (_req, res) => res.status(204).end());

// API: gera música (Suno quando SUNO_API_KEY existe; caso contrário, demo interna)
app.post("/api/generate-instant-song", async (req, res) => {
  const descricao = cleanText(
    req.body?.descricao ?? req.body?.historia ?? req.body?.prompt,
  );

  if (!descricao) {
    return res.status(400).json({ error: "Descreva sua história e o estilo desejados." });
  }
  if (descricao.length < 40) {
    return res.status(400).json({
      error: "Para a IA criar bem a letra, escreva um pouco mais (mínimo 40 caracteres).",
    });
  }
  if (descricao.length > SUNO_SIMPLE_PROMPT_MAX) {
    return res.status(400).json({
      error: `Máximo de ${SUNO_SIMPLE_PROMPT_MAX} caracteres neste modo (pedido oficial da Suno API).`,
    });
  }

  const requestIp = getInstantRequestIp(req);
  const byIp = await readInstantGenerationEventsByIp();
  const limit = INSTANT_GEN_LIMIT_IP;
  const recent = byIp[requestIp] || [];
  if (recent.length >= limit) {
    const windowHours = Math.max(1, Math.round(INSTANT_GEN_IP_WINDOW_MS / (60 * 60 * 1000)));
    return res.status(429).json({
      error: `Você atingiu o limite de prévias grátis nas últimas ${windowHours} horas neste dispositivo/rede. Aguarde esse período para gerar de novo, finalize a compra quando estiver pronto ou fale conosco.`,
      limit,
      windowHours,
    });
  }

  try {
    const songId = randomUUID();
    const fallbackTitle = instantTitleFromHistoria(descricao);

    /** @type {{ audioUrl: string, title: string }[]} */
    let trackPairs = [];

    const sunoTracks = await generateWithSuno(descricao).catch((e) => {
      console.warn("Suno falhou ou indisponível, usando fallback de demonstração:", e?.message || e);
      return null;
    });

    if (Array.isArray(sunoTracks) && sunoTracks.length > 0) {
      trackPairs = sunoTracks;
    } else {
      console.log(`Gerando música (demo): — ${descricao.slice(0, 40)}…`);
      await new Promise((r) => setTimeout(r, 2000));
      const demo =
        "https://res.cloudinary.com/dc48hzb6b/video/upload/v1778091333/Dona_Teresa_u4rkas.mp3";
      trackPairs = [
        { audioUrl: demo, title: "Demo · Versão 1 (adicione SUNO_API_KEY)" },
        { audioUrl: demo, title: "Demo · Versão 2 (mesmo áudio exemplo)" },
      ];
    }

    await persistInstantSongRecord(songId, descricao, trackPairs.slice(0, 2));

    await appendInstantGenerationForIp(requestIp).catch(() => {});

    const v0 = trackPairs[0];
    const v1 = trackPairs[1];
    const title = cleanText(v0?.title) || fallbackTitle;

    res.json({
      success: true,
      songId,
      title,
      tracks: [
        {
          label: "Versão 1",
          previewUrl: v0.audioUrl,
          fullUrl: v0.audioUrl,
          title: v0.title || title,
        },
        ...(v1
          ? [
              {
                label: "Versão 2",
                previewUrl: v1.audioUrl,
                fullUrl: v1.audioUrl,
                title: v1.title || title,
              },
            ]
          : []),
      ],
      previewUrl: v0.audioUrl,
      fullUrl: v0.audioUrl,
      fullUrlB: v1?.audioUrl ?? null,
    });
  } catch (err) {
    console.error("Erro na geração IA:", err);
    res.status(500).json({
      error: err?.message?.startsWith?.("suno_")
        ? "Não foi possível gerar com o Suno. Tente de novo ou use o modo demo sem chave."
        : "Falha ao gerar música. Tente novamente.",
    });
  }
});

// API: Send Download Link via Email
app.post("/api/send-download-link", async (req, res) => {
  const email = cleanText(req.body?.email);
  const downloadsRaw = req.body?.downloads;
  const songUrl = safePublicHttpUrl(req.body?.songUrl);
  const songTitle = cleanText(req.body?.songTitle);

  /** @type {{ label: string, url: string }[]} */
  let downloads = [];
  if (Array.isArray(downloadsRaw)) {
    for (const d of downloadsRaw) {
      const url = safePublicHttpUrl(typeof d?.url === "string" ? d.url : "");
      const label = cleanText(d?.label) || `Versão`;
      if (url) downloads.push({ label, url });
    }
  }
  if (!downloads.length && songUrl) {
    downloads.push({ label: "Versão 1", url: songUrl });
    const alt = safePublicHttpUrl(typeof req.body?.songUrlB === "string" ? req.body.songUrlB : "");
    if (alt && alt !== songUrl) downloads.push({ label: "Versão 2", url: alt });
  }

  if (!email || !downloads.length) {
    return res.status(400).json({ error: "E-mail e links de música são obrigatórios." });
  }

  if (!resend) {
    return res.status(500).json({ error: "Serviço de e-mail não configurado." });
  }

  try {
    const linksHtml = downloads
      .map(
        (row, i) =>
          `<p style="margin:14px 0;"><a href="${escapeHtml(row.url)}" style="display:inline-block; background:${i === 0 ? "#b94f37" : "#0f766e"}; color:#fff; padding:15px 25px; text-decoration:none; border-radius:8px; font-weight:bold;">Baixar ${escapeHtml(row.label)}</a></p>`,
      )
      .join("");

    await resend.emails.send({
      from: "Homenagem Musical <noreply@hmusical.com.br>",
      to: [email],
      subject: "Seus arquivos de áudio chegaram! 🎵",
      html: `
        <h1>Aqui estão suas músicas! ❤️</h1>
        <p>Você pediu cópia de segurança: <strong>${escapeHtml(songTitle || "Sua homenagem")}</strong>.</p>
        <p>Use os botões abaixo para baixar cada versão (MP3).</p>
        ${linksHtml}
        <hr/>
        <p>Homenagem Musical — Eternizando momentos.</p>
      `,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao enviar link de download:", err);
    res.status(500).json({ error: "Erro ao enviar e-mail." });
  }
});

// API: Send Delivery Email
app.post("/api/send-delivery-email", async (req, res) => {
  const { email, deliveryLink } = req.body;

  if (!email || !deliveryLink) {
    return res.status(400).json({ error: "E-mail e link da entrega são obrigatórios." });
  }

  if (!resend) {
    return res.status(500).json({ error: "Serviço de e-mail não configurado (RESEND_API_KEY ausente)." });
  }

  try {
    const { data, error } = await resend.emails.send({
      from: "Homenagem Musical <noreply@hmusical.com.br>",
      to: [email],
      subject: "Sua Homenagem Musical está pronta! ❤️",
      html: `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #16120f; margin: 0; padding: 0; background-color: #f8f9fa; }
            .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
            .content { background: #ffffff; border-radius: 24px; padding: 40px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.05); }
            .logo { font-size: 24px; font-weight: bold; color: #b94f37; text-decoration: none; display: block; margin-bottom: 30px; }
            h1 { font-size: 24px; margin-bottom: 20px; color: #16120f; }
            p { font-size: 16px; margin-bottom: 30px; color: #4a4a4a; line-height: 1.8; }
            .btn { display: inline-block; background-color: #b94f37; color: #ffffff !important; padding: 18px 36px; border-radius: 50px; text-decoration: none; font-weight: bold; font-size: 16px; transition: background-color 0.2s; }
            .footer { text-align: center; margin-top: 30px; font-size: 12px; color: #999; }
            .emoji { font-size: 32px; display: block; margin-bottom: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="content">
              <a href="https://hmusical.com.br" class="logo">♪ Homenagem Musical</a>
              <span class="emoji">🎁</span>
              <h1>Oba! Seu pedido está pronto!</h1>
              <p>Sua música personalizada foi finalizada com todo carinho.<br>
              <strong>Se estiver em pé, procura uma cadeira porque você vai se emocionar.</strong></p>
              <a href="${deliveryLink}" class="btn">Ouvir Minha Homenagem ❤️</a>
            </div>
            <div class="footer">
              <p>© 2026 Homenagem Musical — Eternizando momentos em melodia.</p>
              <p>Este e-mail foi enviado automaticamente. Por favor, não responda.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error("Erro Resend:", error);
      return res.status(400).json({ error: "Erro ao enviar e-mail via Resend." });
    }

    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error("Erro interno no envio de e-mail:", err);
    res.status(500).json({ error: "Erro interno no servidor." });
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
    template = template.replaceAll("[[PHOTO_URL_B]]", data.photoUrlB || '');
    template = template.replaceAll(
      "[[HAS_SECOND_PHOTO_CLASS]]",
      data.photoUrlB && String(data.photoUrlB).trim() ? "has-two-photos" : "",
    );
    template = template.replaceAll("[[SECOND_PHOTO_DOWNLOAD_HTML]]", deliverySecondPhotoDownloadHtml(data.photoUrlB));
    template = template.replaceAll("[[SONG_TITLE]]", data.songTitle);
    template = template.replaceAll("[[LYRICS]]", data.lyrics);
    template = template.replaceAll("[[SONGS_HTML]]", songsHtml);
    
    const expDate = data.expirationDate || getExpirationDate();
    template = template.replaceAll("[[EXPIRATION_MESSAGE]]", `Esta página ficará disponível até o dia ${expDate}`);
    template = template.replaceAll("[[EXPIRATION_DATE]]", expDate);

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
