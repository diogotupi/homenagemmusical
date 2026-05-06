const audioContext = {
  instance: null,
  get() {
    if (!this.instance) {
      this.instance = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this.instance;
  },
};

function playNotes(card) {
  const context = audioContext.get();
  const notes = card.dataset.notes.split(",").map(Number);
  const now = context.currentTime;

  document.querySelectorAll(".song-card").forEach((item) => item.classList.remove("playing"));
  card.classList.add("playing");

  notes.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now + index * 0.22);
    gain.gain.linearRampToValueAtTime(0.16, now + index * 0.22 + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.22 + 0.42);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now + index * 0.22);
    oscillator.stop(now + index * 0.22 + 0.46);
  });

  window.setTimeout(() => card.classList.remove("playing"), notes.length * 240 + 320);
}

document.querySelectorAll(".song-card").forEach((card) => {
  card.querySelector(".play-button").addEventListener("click", () => playNotes(card));
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

  const response = await fetch("http://localhost:3000/create-checkout", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
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
