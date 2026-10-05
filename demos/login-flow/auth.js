// Public, fictional credentials for a local UI demo only.
function authenticate(email, password) {
  return email.trim().toLowerCase() === 'demo@example.test'
    && password === 'Demo123!';
}
