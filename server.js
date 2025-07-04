const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));
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

// Banco de dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/legacy_bot',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Inicializar banco PostgreSQL
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS estoque (
        id SERIAL PRIMARY KEY,
        categoria VARCHAR(255) UNIQUE,
        dados TEXT,
        preco DECIMAL(10,2) DEFAULT 0
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS equipe (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE,
        nome VARCHAR(255),
        cargo VARCHAR(255),
        adicionadoEm TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS backups (
        id SERIAL PRIMARY KEY,
        dados TEXT,
        size INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        customer_id VARCHAR(255),
        customer_name VARCHAR(255),
        product_name VARCHAR(255),
        category VARCHAR(255),
        price DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Banco PostgreSQL inicializado com sucesso!');
  } catch (error) {
    console.error('Erro ao inicializar banco:', error);
  }
}

initDatabase();

// Funções utilitárias
async function lerEstoque() {
  try {
    const result = await pool.query('SELECT * FROM estoque');
    const estoque = {};
    
    result.rows.forEach(row => {
      try {
        const dados = JSON.parse(row.dados);
        estoque[row.categoria] = {
          ...dados,
          preco: parseFloat(row.preco)
        };
      } catch (e) {
        console.error('Erro ao parsear dados:', e);
      }
    });
    
    return estoque;
  } catch (error) {
    console.error('Erro ao ler estoque:', error);
    return {};
  }
}

async function salvarEstoque(estoque) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM estoque');
    
    for (const categoria in estoque) {
      const { preco, ...dados } = estoque[categoria];
      await client.query(
        'INSERT INTO estoque (categoria, dados, preco) VALUES ($1, $2, $3)',
        [categoria, JSON.stringify(dados), preco || 0]
      );
    }
    
    await client.query('COMMIT');
    console.log('Estoque salvo com sucesso!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erro ao salvar estoque:', error);
    throw error;
  } finally {
    client.release();
  }
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

  // Verificar admin
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, message: 'Login realizado com sucesso', role: 'admin' });
    return;
  }

  // Verificar equipe
  try {
    const result = await pool.query('SELECT * FROM equipe WHERE username = $1', [username]);
    
    if (result.rows.length > 0 && password === process.env.ADMIN_PASSWORD) {
      const row = result.rows[0];
      const token = jwt.sign({ 
        username: row.username, 
        role: 'equipe',
        nome: row.nome,
        cargo: row.cargo
      }, process.env.JWT_SECRET, { expiresIn: '24h' });
      
      res.json({ 
        token, 
        message: 'Login realizado com sucesso', 
        role: 'equipe',
        nome: row.nome,
        cargo: row.cargo
      });
    } else {
      res.status(401).json({ error: 'Credenciais inválidas' });
    }
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// API Routes
app.get('/api/estoque', authenticateToken, async (req, res) => {
  try {
    const estoque = await lerEstoque();
    res.json(estoque);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar estoque' });
  }
});

app.get('/api/estoque/stats', authenticateToken, async (req, res) => {
  try {
    const estoque = await lerEstoque();
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
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar estatísticas' });
  }
});

app.post('/api/estoque/categoria', authenticateToken, async (req, res) => {
  try {
    const { nome, tipo, preco } = req.body;
    
    if (!nome || !tipo) {
      return res.status(400).json({ error: 'Nome e tipo são obrigatórios' });
    }
    
    const estoque = await lerEstoque();
    
    if (estoque[nome]) {
      return res.status(400).json({ error: 'Categoria já existe' });
    }
    
    estoque[nome] = { preco: preco || 0 };
    
    if (tipo === 'cartao') estoque[nome].cartoes = [];
    else if (tipo === 'conta') estoque[nome].contas = [];
    else if (tipo === 'giftcard') estoque[nome].codigos = [];
    
    await salvarEstoque(estoque);
    res.json({ message: 'Categoria criada com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar categoria' });
  }
});

app.post('/api/estoque/:categoria/itens', authenticateToken, async (req, res) => {
  try {
    const { categoria } = req.params;
    const { itens, tipo } = req.body;
    
    if (!itens || !Array.isArray(itens)) {
      return res.status(400).json({ error: 'Itens deve ser um array' });
    }
    
    const estoque = await lerEstoque();
    
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
    
    await salvarEstoque(estoque);
    res.json({ message: `${itens.length} itens adicionados` });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao adicionar itens' });
  }
});

app.put('/api/estoque/:categoria/preco', authenticateToken, async (req, res) => {
  try {
    const { categoria } = req.params;
    const { preco } = req.body;
    
    const estoque = await lerEstoque();
    
    if (!estoque[categoria]) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    
    estoque[categoria].preco = preco;
    await salvarEstoque(estoque);
    res.json({ message: 'Preço atualizado' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar preço' });
  }
});

app.delete('/api/estoque/:categoria', authenticateToken, async (req, res) => {
  try {
    const { categoria } = req.params;
    const estoque = await lerEstoque();
    
    if (!estoque[categoria]) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    
    delete estoque[categoria];
    await salvarEstoque(estoque);
    res.json({ message: 'Categoria removida' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover categoria' });
  }
});

app.delete('/api/estoque/:categoria/limpar', authenticateToken, async (req, res) => {
  try {
    const { categoria } = req.params;
    const estoque = await lerEstoque();
    
    if (!estoque[categoria]) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    
    if (estoque[categoria].cartoes) estoque[categoria].cartoes = [];
    if (estoque[categoria].contas) estoque[categoria].contas = [];
    if (estoque[categoria].codigos) estoque[categoria].codigos = [];
    
    await salvarEstoque(estoque);
    res.json({ message: 'Categoria limpa' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao limpar categoria' });
  }
});

// Rota para obter itens de uma categoria
app.get('/api/estoque/:categoria/itens', authenticateToken, async (req, res) => {
  try {
    const { categoria } = req.params;
    const estoque = await lerEstoque();
    
    if (!estoque[categoria]) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    
    let itens = [];
    let tipo = '';
    
    if (estoque[categoria].cartoes) {
      itens = estoque[categoria].cartoes.map((item, index) => ({ id: index, content: item, type: 'cartao' }));
      tipo = 'cartao';
    } else if (estoque[categoria].contas) {
      itens = estoque[categoria].contas.map((item, index) => ({ id: index, content: item, type: 'conta' }));
      tipo = 'conta';
    } else if (estoque[categoria].codigos) {
      itens = estoque[categoria].codigos.map((item, index) => ({ id: index, content: item, type: 'giftcard' }));
      tipo = 'giftcard';
    }
    
    res.json({ itens, tipo, categoria });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar itens' });
  }
});

// Rota para remover item específico
app.delete('/api/estoque/:categoria/item/:index', authenticateToken, async (req, res) => {
  try {
    const { categoria, index } = req.params;
    const itemIndex = parseInt(index);
    const estoque = await lerEstoque();
    
    if (!estoque[categoria]) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }
    
    let removido = false;
    
    if (estoque[categoria].cartoes && itemIndex < estoque[categoria].cartoes.length) {
      estoque[categoria].cartoes.splice(itemIndex, 1);
      removido = true;
    } else if (estoque[categoria].contas && itemIndex < estoque[categoria].contas.length) {
      estoque[categoria].contas.splice(itemIndex, 1);
      removido = true;
    } else if (estoque[categoria].codigos && itemIndex < estoque[categoria].codigos.length) {
      estoque[categoria].codigos.splice(itemIndex, 1);
      removido = true;
    }
    
    if (removido) {
      await salvarEstoque(estoque);
      res.json({ message: 'Item removido com sucesso' });
    } else {
      res.status(404).json({ error: 'Item não encontrado' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erro ao remover item' });
  }
});

// Rota para importar estoque (para o bot)
app.post('/api/estoque/import', authenticateToken, async (req, res) => {
  try {
    const { estoque } = req.body;
    
    if (!estoque || typeof estoque !== 'object') {
      return res.status(400).json({ error: 'Dados de estoque inválidos' });
    }
    
    await salvarEstoque(estoque);
    res.json({ message: 'Estoque importado com sucesso' });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao importar estoque' });
  }
});

// Rotas da equipe
app.get('/api/equipe', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM equipe ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Erro ao buscar equipe:', error);
    res.status(500).json({ error: 'Erro ao buscar equipe' });
  }
});

app.post('/api/equipe', authenticateToken, async (req, res) => {
  const { username, nome, cargo } = req.body;
  
  if (!username || !nome) {
    return res.status(400).json({ error: 'Username e nome são obrigatórios' });
  }
  
  try {
    const result = await pool.query(
      'INSERT INTO equipe (username, nome, cargo) VALUES ($1, $2, $3) RETURNING *',
      [username, nome, cargo || 'Membro']
    );
    
    res.json({ 
      message: 'Membro adicionado com sucesso', 
      membro: result.rows[0] 
    });
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({ error: 'Username já existe' });
    }
    console.error('Erro ao adicionar membro:', error);
    res.status(500).json({ error: 'Erro ao adicionar membro' });
  }
});

app.delete('/api/equipe/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query('DELETE FROM equipe WHERE id = $1', [id]);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }
    
    res.json({ message: 'Membro removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover membro:', error);
    res.status(500).json({ error: 'Erro ao remover membro' });
  }
});

// Rotas de backup
app.post('/api/backup/create', authenticateToken, async (req, res) => {
  try {
    const estoque = await lerEstoque();
    const dados = JSON.stringify(estoque);
    const size = Buffer.byteLength(dados, 'utf8');
    const created_at = new Date().toISOString();
    
    const stmt = db.prepare('INSERT INTO backups (dados, size, created_at) VALUES (?, ?, ?)');
    stmt.run(dados, size, created_at, function(err) {
      if (err) {
        return res.status(500).json({ error: 'Erro ao criar backup' });
      }
      
      res.json({ 
        message: 'Backup criado com sucesso',
        id: this.lastID,
        size,
        created_at
      });
    });
    stmt.finalize();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao criar backup' });
  }
});

app.get('/api/backup/list', authenticateToken, (req, res) => {
  db.all('SELECT id, size, created_at FROM backups ORDER BY created_at DESC LIMIT 10', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao listar backups' });
    }
    res.json(rows);
  });
});

app.get('/api/backup/download/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  db.get('SELECT dados FROM backups WHERE id = ?', [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar backup' });
    }
    
    if (!row) {
      return res.status(404).json({ error: 'Backup não encontrado' });
    }
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=backup-${id}.json`);
    res.send(row.dados);
  });
});

// Rotas do sistema de vendas
app.get('/api/sales/stats', authenticateToken, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  db.all(`
    SELECT 
      COUNT(*) as totalSales,
      COALESCE(SUM(price), 0) as totalRevenue,
      COUNT(DISTINCT customer_id) as totalCustomers,
      COALESCE(SUM(CASE WHEN DATE(created_at) = ? THEN price ELSE 0 END), 0) as todayRevenue
    FROM sales
  `, [today], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar estatísticas' });
    }
    
    const stats = rows[0] || {
      totalSales: 0,
      totalRevenue: 0,
      totalCustomers: 0,
      todayRevenue: 0
    };
    
    res.json(stats);
  });
});

app.get('/api/sales/history', authenticateToken, (req, res) => {
  db.all('SELECT * FROM sales ORDER BY created_at DESC LIMIT 50', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
    res.json(rows);
  });
});

app.get('/api/sales/customers', authenticateToken, (req, res) => {
  db.all(`
    SELECT 
      customer_id,
      customer_name as name,
      COUNT(*) as total_purchases,
      SUM(price) as total_spent,
      MAX(created_at) as last_purchase
    FROM sales 
    GROUP BY customer_id, customer_name 
    ORDER BY total_spent DESC
  `, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar clientes' });
    }
    res.json(rows);
  });
});

app.get('/api/sales/analytics', authenticateToken, (req, res) => {
  const queries = {
    topProducts: `
      SELECT 
        product_name as name,
        category,
        COUNT(*) as sales_count,
        SUM(price) as total_revenue
      FROM sales 
      GROUP BY product_name, category 
      ORDER BY sales_count DESC 
      LIMIT 5
    `,
    topCustomers: `
      SELECT 
        customer_name as name,
        COUNT(*) as total_purchases,
        SUM(price) as total_spent
      FROM sales 
      GROUP BY customer_id, customer_name 
      ORDER BY total_spent DESC 
      LIMIT 5
    `
  };
  
  const results = {};
  let completed = 0;
  
  Object.keys(queries).forEach(key => {
    db.all(queries[key], (err, rows) => {
      if (!err) {
        results[key] = rows;
      } else {
        results[key] = [];
      }
      
      completed++;
      if (completed === Object.keys(queries).length) {
        res.json(results);
      }
    });
  });
});

app.post('/api/sales/add', authenticateToken, (req, res) => {
  const { customer_id, customer_name, product_name, category, price } = req.body;
  
  if (!customer_id || !customer_name || !product_name || !price) {
    return res.status(400).json({ error: 'Dados obrigatórios faltando' });
  }
  
  const stmt = db.prepare('INSERT INTO sales (customer_id, customer_name, product_name, category, price, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(customer_id, customer_name, product_name, category, price, new Date().toISOString(), function(err) {
    if (err) {
      return res.status(500).json({ error: 'Erro ao registrar venda' });
    }
    
    res.json({ 
      message: 'Venda registrada com sucesso',
      id: this.lastID
    });
  });
  stmt.finalize();
});

// Servir o painel web na rota raiz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Fechando banco de dados...');
  db.run('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close((err) => {
    if (err) {
      console.error('Erro ao fechar banco:', err);
    } else {
      console.log('Banco fechado com sucesso');
    }
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Fechando banco de dados...');
  db.run('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close((err) => {
    if (err) {
      console.error('Erro ao fechar banco:', err);
    } else {
      console.log('Banco fechado com sucesso');
    }
    process.exit(0);
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Banco de dados: ${dbPath}`);
});