/* La permission du micro ne se demande pas depuis un panneau latéral : on la donne une fois ici, dans un onglet. */
const etat = document.getElementById('etat');
navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((flux) => {
    flux.getTracks().forEach((p) => p.stop());
    document.getElementById('titre').textContent = '✓';
    document.getElementById('texte').textContent = '';
    setTimeout(() => window.close(), 900);
  })
  .catch((err) => (etat.textContent = String(err?.message ?? err)));
