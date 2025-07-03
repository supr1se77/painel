const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  message: { error: 'Muitas requisições, tente novamente em 1 minuto' }
});
app.use(limiter);

// Servir arquivos estáticos (painel web)
app.use(express.static(path.join(__dirname, 'public')));

// Arquivos de dados
const estoquePath = path.resolve(__dirname, 'estoque.json');
const equipePath = path.resolve(__dirname, 'equipe.json');

// Funções utilitárias
function lerEstoque() {
  if (!fs.existsSync(estoquePath)) {
    fs.writeFileSync(estoquePath, JSON.stringify({}, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(estoquePath, 'utf-8'));
  } catch (e) {
    return {};
  }
}

function salvarEstoque(estoque) {
  fs.writeFileSync(estoquePath, JSON.stringify(estoque, null, 2));
}

// Middleware de autenticação
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token de acesso requerido' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

// Rota de login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, message: 'Login realizado com sucesso', role: 'admin' });
  } else {
    res.status(401).json({ error: 'Credenciais inválidas' });
  }
});

// API Routes
app.get('/api/estoque', authenticateToken, (req, res) => {
  res.json(lerEstoque());
});

app.get('/api/estoque/stats', authenticateToken, (req, res) => {
  const estoque = lerEstoque();
  const stats = {};
  
  for (const categoria in estoque) {
    const item = estoque[categoria];
    let quantidade = 0;
    
    if (item.cartoes) quantidade = item.cartoes.length;
    else if (item.contas) quantidade = item.contas.length;
    else if (item.codigos) quantidade = item.codigos.length;
    
    stats[categoria] = {
      quantidade,
      preco: item.preco || 0
    };
  }
  
  res.json(stats);
});

app.post('/api/estoque/categoria', authenticateToken, (req, res) => {
  const { nome, tipo, preco } = req.body;
  
  if (!nome || !tipo) {
    return res.status(400).json({ error: 'Nome e tipo são obrigatórios' });
  }
  
  const estoque = lerEstoque();
  
  if (estoque[nome]) {
    return res.status(400).json({ error: 'Categoria já existe' });
  }
  
  estoque[nome] = { preco: preco || 0 };
  
  if (tipo === 'cartao') estoque[nome].cartoes = [];
  else if (tipo === 'conta') estoque[nome].contas = [];
  else if (tipo === 'giftcard') estoque[nome].codigos = [];
  
  salvarEstoque(estoque);
  res.json({ message: 'Categoria criada com sucesso' });
});

app.post('/api/estoque/:categoria/itens', authenticateToken, (req, res) => {
  const { categoria } = req.params;
  const { itens, tipo } = req.body;
  
  if (!itens || !Array.isArray(itens)) {
    return res.status(400).json({ error: 'Itens deve ser um array' });
  }
  
  const estoque = lerEstoque();
  
  if (!estoque[categoria]) {
    return res.status(404).json({ error: 'Categoria não encontrada' });
  }
  
  if (tipo === 'cartao' && estoque[categoria].cartoes) {
    estoque[categoria].cartoes.push(...itens);
  } else if (tipo === 'conta' && estoque[categoria].contas) {
    estoque[categoria].contas.push(...itens);
  } else if (tipo === 'giftcard' && estoque[categoria].codigos) {
    estoque[categoria].codigos.push(...itens);
  } else {
    return res.status(400).json({ error: 'Tipo inválido' });
  }
  
  salvarEstoque(estoque);
  res.json({ message: `${itens.length} itens adicionados` });
});

app.put('/api/estoque/:categoria/preco', authenticateToken, (req, res) => {
  const { categoria } = req.params;
  const { preco } = req.body;
  
  const estoque = lerEstoque();
  
  if (!estoque[categoria]) {
    return res.status(404).json({ error: 'Categoria não encontrada' });
  }
  
  estoque[categoria].preco = preco;
  salvarEstoque(estoque);
  res.json({ message: 'Preço atualizado' });
});

app.delete('/api/estoque/:categoria', authenticateToken, (req, res) => {
  const { categoria } = req.params;
  const estoque = lerEstoque();
  
  if (!estoque[categoria]) {
    return res.status(404).json({ error: 'Categoria não encontrada' });
  }
  
  delete estoque[categoria];
  salvarEstoque(estoque);
  res.json({ message: 'Categoria removida' });
});

app.delete('/api/estoque/:categoria/limpar', authenticateToken, (req, res) => {
  const { categoria } = req.params;
  const estoque = lerEstoque();
  
  if (!estoque[categoria]) {
    return res.status(404).json({ error: 'Categoria não encontrada' });
  }
  
  if (estoque[categoria].cartoes) estoque[categoria].cartoes = [];
  if (estoque[categoria].contas) estoque[categoria].contas = [];
  if (estoque[categoria].codigos) estoque[categoria].codigos = [];
  
  salvarEstoque(estoque);
  res.json({ message: 'Categoria limpa' });
});

// Rota para importar estoque (para o bot)
app.post('/api/estoque/import', authenticateToken, (req, res) => {
  try {
    const { estoque } = req.body;
    
    if (!estoque || typeof estoque !== 'object') {
      return res.status(400).json({ error: 'Dados de estoque inválidos' });
    }
    
    salvarEstoque(estoque);
    res.json({ message: 'Estoque importado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao importar estoque' });
  }
});

// Servir o painel web na rota raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});