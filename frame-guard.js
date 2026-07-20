(function protectSensitivePageFromFraming() {
  if (window.top === window.self) {
    document.documentElement.classList.remove('frame-guard-pending');
    document.getElementById('anti-clickjack')?.remove();
    return;
  }

  try {
    window.top.location = window.self.location;
  } catch {
    // Mantém a página invisível quando um site externo impede a navegação do frame.
  }
})();
