let currentAudio = null;
let currentPlayingCard = null;

function playAudio(card) {
  const audioUrl = card.dataset.audio;
  if (!audioUrl) return;

  // Se já estiver tocando este card, para
  if (currentPlayingCard === card) {
    currentAudio.pause();
    currentAudio = null;
    currentPlayingCard = null;
    card.classList.remove("playing");
    card.querySelector(".play-button").textContent = "▶";
    return;
  }

  // Se houver outro tocando, para ele
  if (currentAudio) {
    currentAudio.pause();
    currentPlayingCard.classList.remove("playing");
    currentPlayingCard.querySelector(".play-button").textContent = "▶";
  }

  // Inicia o novo
  currentAudio = new Audio(audioUrl);
  currentPlayingCard = card;
  card.classList.add("playing");
  card.querySelector(".play-button").textContent = "⏸";

  currentAudio.play();

  currentAudio.onended = () => {
    card.classList.remove("playing");
    card.querySelector(".play-button").textContent = "▶";
    currentPlayingCard = null;
    currentAudio = null;
  };
}

document.querySelectorAll(".song-card").forEach((card) => {
  card.querySelector(".play-button").addEventListener("click", () => playAudio(card));
});

document.querySelectorAll(".faq-item").forEach((item) => {
  item.addEventListener("click", () => {
    const isOpen = item.classList.toggle("open");
    item.querySelector("strong").textContent = isOpen ? "-" : "+";
  });
});

const planPages = document.querySelectorAll("[data-plan-page]");

function showPlanPage(plan) {
  const page = document.querySelector(`[data-plan-page="${plan}"]`);

  if (!page) {
    return;
  }

  planPages.forEach((item) => {
    item.hidden = item !== page;
  });

  page.hidden = false;
  page.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelectorAll(".plan-select").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    showPlanPage(button.dataset.plan);
  });
});

const initialPlan = window.location.hash.replace("#pedido-", "");

if (initialPlan) {
  showPlanPage(initialPlan);
}

document.querySelectorAll('input[type="file"][name="foto"]').forEach((input) => {
  input.addEventListener("change", () => {
    const checkSpan = input.closest('label').querySelector('.foto-check');
    if (input.files.length > 1) {
      input.value = "";
    }

    if (checkSpan) {
      if (input.files.length === 1) {
        checkSpan.removeAttribute('hidden');
      } else {
        checkSpan.setAttribute('hidden', '');
      }
    }
  });
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      const result = String(reader.result);
      const [, content = ""] = result.split(",");
      resolve(content);
    });

    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

async function sendOrder(form, note) {
  const formData = new FormData(form);
  const photo = formData.get("foto");
  const data = {
    nome: formData.get("nome"),
    whatsapp: formData.get("whatsapp"),
    email: formData.get("email"),
    ocasiao: formData.get("ocasiao"),
    estilo: formData.get("estilo"),
    historia: formData.get("historia"),
    pacote: form.dataset.plan,
  };

  if (photo instanceof File && photo.size > 0) {
    data.foto = {
      nome: photo.name,
      tipo: photo.type,
      conteudo: await fileToBase64(photo),
    };
  }

  note.textContent = "Abrindo checkout...";

  const response = await fetch("/create-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    throw new Error("orders_api_unavailable");
  }

  const result = await response.json();

  if (!result.url) {
    throw new Error("checkout_url_missing");
  }

  window.location.href = result.url;
}

document.querySelectorAll('textarea[name="historia"]').forEach(textarea => {
  const counter = textarea.closest('label').querySelector('.char-counter');
  if (!counter) return;

  const updateCounter = () => {
    const count = textarea.value.length;
    if (count >= 100) {
      counter.classList.remove('invalid');
      counter.classList.add('valid');
      counter.textContent = `${count} caracteres (mínimo atingido)`;
    } else {
      counter.classList.remove('valid');
      counter.classList.add('invalid');
      counter.textContent = `${count} / 100 caracteres mínimos`;
    }
  };

  textarea.addEventListener('input', updateCounter);
  updateCounter(); // Initialize
});

document.querySelectorAll(".order-form").forEach((form) => {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const note = form.querySelector(".form-note");
    const photoInput = form.querySelector('input[type="file"][name="foto"]');

    if (photoInput && photoInput.files.length !== 1) {
      note.textContent = "Envie uma única foto para continuar.";
      return;
    }

    try {
      await sendOrder(form, note);
    } catch (error) {
      console.error("Erro no checkout:", error);
      note.textContent =
        "Não foi possível abrir o checkout. Verifique se o servidor local está rodando e tente novamente.";
    }
  });
});
