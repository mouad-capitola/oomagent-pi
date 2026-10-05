const form = document.querySelector('#login-form');
const loginView = document.querySelector('#login-view');
const dashboard = document.querySelector('#dashboard');
const error = document.querySelector('#error');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = document.querySelector('#email').value;
  const password = document.querySelector('#password').value;
  if (!authenticate(email, password)) {
    error.textContent = 'Onjuist e-mailadres of wachtwoord.';
    error.hidden = false;
    return;
  }
  error.hidden = true;
  document.querySelector('#email').value = '';
  document.querySelector('#password').value = '';
  loginView.hidden = true;
  dashboard.hidden = false;
});

document.querySelector('#logout-button').addEventListener('click', () => {
  dashboard.hidden = true;
  loginView.hidden = false;
  error.hidden = true;
  document.querySelector('#email').value = '';
  document.querySelector('#password').value = '';
});
