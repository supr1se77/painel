const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
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

// Banco de dados SQLite com caminho persistente
const dbPath = process.env.NODE_ENV === 'production' ? '/app/data/estoque.db' : './estoque.db';
const db = new sqlite3.Database(dbPath);

// Criar diretório de dados se não existir
if (process.env.NODE_ENV === 'production') {
  const dataDir = '/app/data';
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Inicializar banco com WAL mode para melhor persistência
db.serialize(() => {
  // Configurar WAL mode para melhor persistência
  db.run('PRAGMA journal_mode=WAL;');
  db.run('PRAGMA synchronous=NORMAL;');
  db.run('PRAGMA cache_size=1000;');
  db.run('PRAGMA temp_store=memory;');
  
  db.run(`CREATE TABLE IF NOT EXISTS estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria TEXT UNIQUE,
    dados TEXT,
    preco REAL DEFAULT 0
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS equipe (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    nome TEXT,
    cargo TEXT,
    adicionadoEm TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dados TEXT,
    size INTEGER,
    created_at TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT,
    customer_name TEXT,
    product_name TEXT,
    category TEXT,
    price REAL,
    created_at TEXT
  )`);
  
  console.log(`Banco de dados inicializado em: ${dbPath}`);
});

// Forçar sincronização do banco a cada 30 segundos
setInterval(() => {
  db.run('PRAGMA wal_checkpoint(TRUNCATE);');
}, 30000);

// Funções utilitárias
function lerEstoque() {
  return new Promise((resolve) => {
    db.all('SELECT * FROM estoque', (err, rows) => {
      if (err) {
        console.error('Erro ao ler estoque:', err);
        resolve({});
        return;
      }
      
      const estoque = {};
      rows.forEach(row => {
        try {
          const dados = JSON.parse(row.dados);
          estoque[row.categoria] = {
            ...dados,
            preco: row.preco
          };
        } catch (e) {
          console.error('Erro ao parsear dados:', e);
        }
      });
      resolve(estoque);
    });
  });
}

function salvarEstoque(estoque) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run('DELETE FROM estoque');
      
      const stmt = db.prepare('INSERT INTO estoque (categoria, dados, preco) VALUES (?, ?, ?)');
      
      for (const categoria in estoque) {
        const { preco, ...dados } = estoque[categoria];
        stmt.run(categoria, JSON.stringify(dados), preco || 0);
      }
      
      stmt.finalize((err) => {
        if (err) {
          db.run('ROLLBACK');
          reject(err);
        } else {
          db.run('COMMIT', (commitErr) => {
            if (commitErr) {
              reject(commitErr);
            } else {
              // Forçar sincronização
              db.run('PRAGMA wal_checkpoint(TRUNCATE);');
              console.log('Estoque salvo e sincronizado');
              resolve();
            }
          });
        }
      });
    });
  });
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
app.get('/api/equipe', authenticateToken, (req, res) => {
  db.all('SELECT * FROM equipe', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao buscar equipe' });
    }
    res.json(rows);
  });
});

app.post('/api/equipe', authenticateToken, (req, res) => {
  const { username, nome, cargo } = req.body;
  
  if (!username || !nome) {
    return res.status(400).json({ error: 'Username e nome são obrigatórios' });
  }
  
  const stmt = db.prepare('INSERT INTO equipe (username, nome, cargo, adicionadoEm) VALUES (?, ?, ?, ?)');
  stmt.run(username, nome, cargo || 'Membro', new Date().toISOString(), function(err) {
    if (err) {
      if (err.code === 'SQLITE_CONSTRAINT') {
        return res.status(400).json({ error: 'Username já existe' });
      }
      return res.status(500).json({ error: 'Erro ao adicionar membro' });
    }
    
    const novoMembro = {
      id: this.lastID,
      username,
      nome,
      cargo: cargo || 'Membro',
      adicionadoEm: new Date().toISOString()
    };
    
    res.json({ message: 'Membro adicionado com sucesso', membro: novoMembro });
  });
  stmt.finalize();
});

app.delete('/api/equipe/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  const stmt = db.prepare('DELETE FROM equipe WHERE id = ?');
  stmt.run(id, function(err) {
    if (err) {
      return res.status(500).json({ error: 'Erro ao remover membro' });
    }
    
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }
    
    res.json({ message: 'Membro removido com sucesso' });
  });
  stmt.finalize();
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