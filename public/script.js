// Configuração da API (agora vem do config-api.js)
// const API_BASE_URL será definido automaticamente
let authToken = localStorage.getItem('authToken');
let API_BASE_URL = '/api';

// Elementos DOM
const loginScreen = document.getElementById('loginScreen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('loginForm');

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    createParticles();
    startUptime();
    if (authToken) {
        showDashboard();
    } else {
        showLogin();
    }
});

// Contador de uptime
let startTime = Date.now();
function startUptime() {
    setInterval(() => {
        const uptimeElement = document.getElementById('uptime');
        if (uptimeElement) {
            const elapsed = Date.now() - startTime;
            const hours = Math.floor(elapsed / 3600000);
            const minutes = Math.floor((elapsed % 3600000) / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            uptimeElement.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
    }, 1000);
}

// Criar efeito de partículas
function createParticles() {
    const particlesContainer = document.createElement('div');
    particlesContainer.className = 'particles';
    document.body.appendChild(particlesContainer);
    
    for (let i = 0; i < 50; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        particle.style.left = Math.random() * 100 + '%';
        particle.style.animationDelay = Math.random() * 15 + 's';
        particle.style.animationDuration = (Math.random() * 10 + 10) + 's';
        particlesContainer.appendChild(particle);
    }
}

// Funções de autenticação
function showLogin() {
    loginScreen.classList.remove('d-none');
    dashboard.classList.add('d-none');
}

function showDashboard() {
    loginScreen.classList.add('d-none');
    dashboard.classList.remove('d-none');
    updateUserInfo();
    loadEstoque();
    loadStats();
}

// Atualizar informações do usuário
function updateUserInfo() {
    const userRole = localStorage.getItem('userRole') || 'admin';
    const userName = localStorage.getItem('userName') || '';
    const userCargo = localStorage.getItem('userCargo') || '';
    const userInfo = document.getElementById('userInfo');
    
    if (userRole === 'admin') {
        userInfo.innerHTML = '<i class="fas fa-crown me-1" style="color: #ffd700;"></i>Administrador';
    } else {
        userInfo.innerHTML = `<i class="fas fa-user me-1" style="color: #7877c6;"></i>${userName} - ${userCargo}`;
    }
}

// Login
loginForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });
        
        if (response.status === 429) {
            showAlert('Muitas tentativas de login. Aguarde um momento e tente novamente.', 'warning');
            return;
        }
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('userRole', data.role || 'admin');
            
            // Salvar informações da equipe se existirem
            if (data.nome) localStorage.setItem('userName', data.nome);
            if (data.cargo) localStorage.setItem('userCargo', data.cargo);
            
            showAlert('Login realizado com sucesso!', 'success');
            showDashboard();
        } else {
            showAlert(data.error || 'Erro no login', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão com a API', 'danger');
        console.error('Erro:', error);
    }
});

// Logout
function logout() {
    localStorage.removeItem('authToken');
    localStorage.removeItem('userRole');
    localStorage.removeItem('userName');
    localStorage.removeItem('userCargo');
    authToken = null;
    showLogin();
}

// Carregar estatísticas
async function loadStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/estoque/stats`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.status === 429) {
            console.log('Rate limit atingido para stats, tentando novamente em 2s...');
            setTimeout(loadStats, 2000);
            return;
        }
        
        if (response.ok) {
            const stats = await response.json();
            displayStats(stats);
        }
    } catch (error) {
        console.error('Erro ao carregar stats:', error);
    }
}

// Exibir estatísticas
function displayStats(stats) {
    const statsCards = document.getElementById('statsCards');
    let totalItems = 0;
    let totalValue = 0;
    
    for (const categoria in stats) {
        totalItems += stats[categoria].quantidade;
        totalValue += stats[categoria].quantidade * stats[categoria].preco;
    }
    
    statsCards.innerHTML = `
        <div class="col-md-4">
            <div class="stats-card" style="animation-delay: 0.1s;">
                <h3>${Object.keys(stats).length}</h3>
                <p><i class="fas fa-layer-group me-2"></i>Categorias Ativas</p>
            </div>
        </div>
        <div class="col-md-4">
            <div class="stats-card" style="animation-delay: 0.2s;">
                <h3>${totalItems.toLocaleString()}</h3>
                <p><i class="fas fa-cube me-2"></i>Itens em Estoque</p>
            </div>
        </div>
        <div class="col-md-4">
            <div class="stats-card" style="animation-delay: 0.3s;">
                <h3>R$ ${totalValue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</h3>
                <p><i class="fas fa-gem me-2"></i>Valor Total</p>
            </div>
        </div>
    `;
}

// Carregar estoque
async function loadEstoque() {
    const estoqueContent = document.getElementById('estoqueContent');
    estoqueContent.innerHTML = '<div class="loading"><div class="spinner-border"></div><p class="mt-3" style="color: rgba(255,255,255,0.8);">Sincronizando dados...</p></div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/estoque`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const estoque = await response.json();
            displayEstoque(estoque);
            loadStats(); // Atualizar stats também
        } else {
            estoqueContent.innerHTML = '<div class="alert alert-danger">Erro ao carregar estoque</div>';
        }
    } catch (error) {
        estoqueContent.innerHTML = '<div class="alert alert-danger">Erro de conexão</div>';
        console.error('Erro:', error);
    }
}

// Função para mostrar alertas
function showAlert(message, type) {
    const existingAlerts = document.querySelectorAll('.alert-floating');
    existingAlerts.forEach(alert => alert.remove());
    
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-floating position-fixed`;
    alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close float-end" onclick="this.parentElement.remove()"></button>
    `;
    
    document.body.appendChild(alert);
    
    setTimeout(() => {
        if (alert.parentElement) {
            alert.remove();
        }
    }, 5000);
}

// Exibir estoque
function displayEstoque(estoque) {
    const estoqueContent = document.getElementById('estoqueContent');
    
    if (Object.keys(estoque).length === 0) {
        estoqueContent.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-box-open fa-4x mb-3" style="color: rgba(120, 119, 198, 0.5);"></i>
                <h4 style="color: rgba(255,255,255,0.8);">Estoque Vazio</h4>
                <p style="color: rgba(255,255,255,0.6);">Crie sua primeira categoria para começar</p>
                <button class="btn btn-primary" onclick="showAddCategoryModal()" style="border-radius: 20px; padding: 10px 30px;">
                    <i class="fas fa-plus me-2"></i>Criar Categoria
                </button>
            </div>
        `;
        return;
    }
    
    let html = '<div class="row">';
    
    for (const categoria in estoque) {
        const item = estoque[categoria];
        let quantidade = 0;
        let tipo = 'indefinido';
        
        if (item.cartoes) {
            quantidade = item.cartoes.length;
            tipo = 'cartao';
        } else if (item.contas) {
            quantidade = item.contas.length;
            tipo = 'conta';
        } else if (item.codigos) {
            quantidade = item.codigos.length;
            tipo = 'giftcard';
        }
        
        const statusColor = quantidade > 0 ? '#27ae60' : '#e74c3c';
        const statusIcon = quantidade > 0 ? 'fas fa-check-circle' : 'fas fa-exclamation-triangle';
        const statusText = quantidade > 0 ? 'Em Estoque' : 'Vazio';
        
        html += `
            <div class="col-md-6 col-lg-4 mb-4">
                <div class="card category-card">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-3">
                            <h5 class="card-title" style="color: #fff; font-weight: 600; font-size: 1.2rem;">${categoria}</h5>
                            <span class="badge" style="background: ${statusColor}; font-size: 0.75rem; padding: 6px 10px;">
                                <i class="${statusIcon} me-1"></i>${statusText}
                            </span>
                        </div>
                        <div class="product-info mb-4">
                            <div class="info-row">
                                <div class="info-label">
                                    <i class="fas fa-cube me-2"></i>Quantidade
                                </div>
                                <div class="info-value quantity-value">
                                    ${quantidade.toLocaleString()}
                                </div>
                            </div>
                            <div class="info-row">
                                <div class="info-label">
                                    <i class="fas fa-tag me-2"></i>Preço Unitário
                                </div>
                                <div class="info-value price-value">
                                    R$ ${(item.preco || 0).toLocaleString('pt-BR', {minimumFractionDigits: 2})}
                                </div>
                            </div>
                        </div>
                        <div class="category-actions">
                            <button class="btn category-btn category-btn-add btn-sm" onclick="showAddItemsModal('${categoria}', '${tipo}')">
                                <i class="fas fa-plus me-1"></i>Adicionar
                            </button>
                            <button class="btn category-btn category-btn-view btn-sm" onclick="showItemsModal('${categoria}')">
                                <i class="fas fa-eye me-1"></i>Ver Itens
                            </button>
                            <button class="btn category-btn category-btn-price btn-sm" onclick="updatePrice('${categoria}')">
                                <i class="fas fa-dollar-sign me-1"></i>Preço
                            </button>
                            <button class="btn category-btn category-btn-clear btn-sm" onclick="clearCategory('${categoria}')">
                                <i class="fas fa-broom me-1"></i>Limpar
                            </button>
                            <button class="btn category-btn category-btn-delete btn-sm" onclick="deleteCategory('${categoria}')">
                                <i class="fas fa-trash me-1"></i>Excluir
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    html += '</div>';
    estoqueContent.innerHTML = html;
}

// Modal para adicionar categoria
function showAddCategoryModal() {
    const modal = new bootstrap.Modal(document.getElementById('addCategoryModal'));
    modal.show();
}

// Modal para gerenciar equipe
function showTeamModal() {
    const modal = new bootstrap.Modal(document.getElementById('teamModal'));
    loadTeamMembers();
    modal.show();
}

// Carregar membros da equipe
async function loadTeamMembers() {
    const teamList = document.getElementById('teamMembersList');
    teamList.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm"></div> Carregando...</div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/equipe`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const equipe = await response.json();
            displayTeamMembers(equipe);
        } else {
            teamList.innerHTML = '<div class="alert alert-danger">Erro ao carregar equipe</div>';
        }
    } catch (error) {
        teamList.innerHTML = '<div class="alert alert-danger">Erro de conexão</div>';
        console.error('Erro:', error);
    }
}

// Exibir membros da equipe
function displayTeamMembers(equipe) {
    const teamList = document.getElementById('teamMembersList');
    
    if (equipe.length === 0) {
        teamList.innerHTML = `
            <div class="text-center py-4">
                <i class="fas fa-users fa-3x mb-3" style="color: rgba(120, 119, 198, 0.5);"></i>
                <h6 style="color: rgba(255,255,255,0.8);">Nenhum membro na equipe</h6>
                <p style="color: rgba(255,255,255,0.6); font-size: 0.9rem;">Adicione o primeiro membro acima</p>
            </div>
        `;
        return;
    }
    
    let html = '<div class="row">';
    
    equipe.forEach(membro => {
        const dataFormatada = new Date(membro.adicionadoEm).toLocaleDateString('pt-BR');
        html += `
            <div class="col-md-6 mb-3">
                <div class="card" style="background: rgba(26, 26, 46, 0.6); border: 1px solid rgba(120, 119, 198, 0.2);">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <h6 class="mb-1" style="color: #fff;">${membro.nome}</h6>
                                <p class="mb-1" style="color: #7877c6; font-size: 0.9rem;">@${membro.username}</p>
                                <span class="badge" style="background: linear-gradient(45deg, #7877c6, #ff77c6); font-size: 0.75rem;">
                                    ${membro.cargo}
                                </span>
                            </div>
                            <button class="btn btn-danger btn-sm" onclick="removeTeamMember(${membro.id})" title="Remover membro">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                        <div class="mt-2">
                            <small style="color: rgba(255,255,255,0.6);">
                                <i class="fas fa-calendar me-1"></i>Adicionado em ${dataFormatada}
                            </small>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    teamList.innerHTML = html;
}

// Adicionar membro da equipe
async function addTeamMember() {
    const username = document.getElementById('memberUsername').value.trim();
    const nome = document.getElementById('memberName').value.trim();
    const cargo = document.getElementById('memberRole').value;
    
    if (!username || !nome) {
        showAlert('Preencha username e nome', 'danger');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/equipe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ username, nome, cargo })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert(`Membro ${nome} adicionado com sucesso!`, 'success');
            document.getElementById('addTeamMemberForm').reset();
            loadTeamMembers();
        } else {
            showAlert(data.error || 'Erro ao adicionar membro', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Remover membro da equipe
async function removeTeamMember(id) {
    if (!confirm('Tem certeza que deseja remover este membro da equipe?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/equipe/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('Membro removido com sucesso!', 'success');
            loadTeamMembers();
        } else {
            showAlert(data.error || 'Erro ao remover membro', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Adicionar categoria
async function addCategory() {
    const nome = document.getElementById('categoryName').value;
    const tipo = document.getElementById('categoryType').value;
    const preco = parseFloat(document.getElementById('categoryPrice').value) || 0;
    
    if (!nome || !tipo) {
        showAlert('Preencha todos os campos obrigatórios', 'danger');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/estoque/categoria`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ nome, tipo, preco })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('Categoria criada com sucesso!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('addCategoryModal')).hide();
            document.getElementById('addCategoryForm').reset();
            loadEstoque();
        } else {
            showAlert(data.error || 'Erro ao criar categoria', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Modal para adicionar itens
let currentCategory = '';
let currentType = '';

function showAddItemsModal(categoria, tipo) {
    currentCategory = categoria;
    currentType = tipo;
    document.querySelector('#addItemsModal .modal-title').textContent = `Adicionar Itens - ${categoria}`;
    const modal = new bootstrap.Modal(document.getElementById('addItemsModal'));
    modal.show();
}

// Adicionar itens
async function addItems() {
    const itemsText = document.getElementById('itemsText').value.trim();
    
    if (!itemsText) {
        showAlert('Digite os itens para adicionar', 'danger');
        return;
    }
    
    let itens = [];
    const linhas = itemsText.split('\n').filter(linha => linha.trim());
    
    try {
        if (currentType === 'conta') {
            // Para contas, espera-se JSON
            itens = linhas.map(linha => JSON.parse(linha.trim()));
        } else {
            // Para cartões e gift cards, apenas strings
            itens = linhas.map(linha => linha.trim());
        }
        
        const response = await fetch(`${API_BASE_URL}/estoque/${currentCategory}/itens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ itens, tipo: currentType })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert(data.message, 'success');
            bootstrap.Modal.getInstance(document.getElementById('addItemsModal')).hide();
            document.getElementById('itemsText').value = '';
            loadEstoque();
        } else {
            showAlert(data.error || 'Erro ao adicionar itens', 'danger');
        }
    } catch (error) {
        showAlert('Erro no formato dos dados ou conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Atualizar preço
async function updatePrice(categoria) {
    const novoPreco = prompt(`Digite o novo preço para ${categoria}:`);
    
    if (novoPreco === null) return;
    
    const preco = parseFloat(novoPreco);
    
    if (isNaN(preco) || preco < 0) {
        showAlert('Preço inválido', 'danger');
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/estoque/${categoria}/preco`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ preco })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('Preço atualizado com sucesso!', 'success');
            loadEstoque();
        } else {
            showAlert(data.error || 'Erro ao atualizar preço', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Limpar categoria
async function clearCategory(categoria) {
    if (!confirm(`Tem certeza que deseja limpar todos os itens de ${categoria}?`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/estoque/${categoria}/limpar`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('Categoria limpa com sucesso!', 'success');
            loadEstoque();
        } else {
            showAlert(data.error || 'Erro ao limpar categoria', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Excluir categoria
async function deleteCategory(categoria) {
    if (!confirm(`Tem certeza que deseja excluir a categoria ${categoria}? Esta ação não pode ser desfeita.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/estoque/${categoria}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('Categoria excluída com sucesso!', 'success');
            loadEstoque();
        } else {
            showAlert(data.error || 'Erro ao excluir categoria', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Modal para visualizar itens
function showItemsModal(categoria) {
    loadCategoryItems(categoria);
    const modal = new bootstrap.Modal(document.getElementById('viewItemsModal'));
    document.querySelector('#viewItemsModal .modal-title').innerHTML = `<i class="fas fa-list me-2"></i>Itens - ${categoria}`;
    modal.show();
}

// Carregar itens da categoria
async function loadCategoryItems(categoria) {
    const itemsList = document.getElementById('itemsList');
    itemsList.innerHTML = '<div class="text-center py-4"><div class="spinner-border"></div><p class="mt-2">Carregando itens...</p></div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/estoque/${categoria}/itens`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            displayCategoryItems(data);
        } else {
            itemsList.innerHTML = '<div class="alert alert-danger">Erro ao carregar itens</div>';
        }
    } catch (error) {
        itemsList.innerHTML = '<div class="alert alert-danger">Erro de conexão</div>';
        console.error('Erro:', error);
    }
}

// Exibir itens da categoria
function displayCategoryItems(data) {
    const itemsList = document.getElementById('itemsList');
    const { itens, tipo, categoria } = data;
    
    if (itens.length === 0) {
        itemsList.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-inbox fa-4x mb-3" style="color: rgba(120, 119, 198, 0.5);"></i>
                <h5 style="color: rgba(255,255,255,0.8);">Categoria Vazia</h5>
                <p style="color: rgba(255,255,255,0.6);">Não há itens nesta categoria</p>
            </div>
        `;
        return;
    }
    
    let html = '<div class="row">';
    
    itens.forEach((item, index) => {
        let displayContent = '';
        let iconClass = '';
        let badgeColor = '';
        
        if (tipo === 'cartao') {
            const parts = item.content.split('|');
            const numero = parts[0] || 'N/A';
            const maskedNumber = numero.length > 6 ? numero.slice(0, 6) + ' **** **** ****' : numero;
            displayContent = `
                <strong>Cartão:</strong> ${maskedNumber}<br>
                <small style="color: rgba(255,255,255,0.7);">${item.content}</small>
            `;
            iconClass = 'fas fa-credit-card';
            badgeColor = '#3498db';
        } else if (tipo === 'conta') {
            const conta = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
            displayContent = `
                <strong>Login:</strong> ${conta.login}<br>
                <strong>Senha:</strong> ${conta.senha}
            `;
            iconClass = 'fas fa-user-circle';
            badgeColor = '#27ae60';
        } else if (tipo === 'giftcard') {
            displayContent = `
                <strong>Código:</strong> ${item.content}
            `;
            iconClass = 'fas fa-gift';
            badgeColor = '#e74c3c';
        }
        
        html += `
            <div class="col-md-6 col-lg-4 mb-3">
                <div class="card" style="background: rgba(26, 26, 46, 0.8); border: 1px solid rgba(120, 119, 198, 0.2);">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <span class="badge" style="background: ${badgeColor}; font-size: 0.75rem;">
                                <i class="${iconClass} me-1"></i>${tipo.toUpperCase()}
                            </span>
                            <button class="btn btn-danger btn-sm" onclick="removeItem('${categoria}', ${item.id})" title="Remover item">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                        <div style="color: #fff; font-size: 0.9rem;">
                            ${displayContent}
                        </div>
                        <div class="mt-2">
                            <small style="color: rgba(255,255,255,0.5);">
                                <i class="fas fa-hashtag me-1"></i>ID: ${item.id}
                            </small>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    itemsList.innerHTML = html;
}

// Remover item específico
async function removeItem(categoria, itemId) {
    if (!confirm('Tem certeza que deseja remover este item?')) {
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE_URL}/estoque/${categoria}/item/${itemId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('Item removido com sucesso!', 'success');
            loadCategoryItems(categoria);
            loadEstoque(); // Atualizar o dashboard principal
        } else {
            showAlert(data.error || 'Erro ao remover item', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Função para exibir alertas
function showAlert(message, type) {
    // Remove alertas existentes
    const existingAlerts = document.querySelectorAll('.alert-floating');
    existingAlerts.forEach(alert => alert.remove());
    
    // Cria novo alerta
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-floating position-fixed`;
    alert.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
    alert.innerHTML = `
        ${message}
        <button type="button" class="btn-close float-end" onclick="this.parentElement.remove()"></button>
    `;
    
    document.body.appendChild(alert);
    
    // Remove automaticamente após 5 segundos
    setTimeout(() => {
        if (alert.parentElement) {
            alert.remove();
        }
    }, 5000);
}

// Funções de backup
function showBackupModal() {
    const modal = new bootstrap.Modal(document.getElementById('backupModal'));
    loadBackupList();
    modal.show();
}

async function createBackup() {
    try {
        const response = await fetch(`${API_BASE_URL}/backup/create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('Backup criado com sucesso!', 'success');
            loadBackupList();
        } else {
            showAlert(data.error || 'Erro ao criar backup', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

async function loadBackupList() {
    const backupList = document.getElementById('backupList');
    backupList.innerHTML = '<div class="text-center"><div class="spinner-border spinner-border-sm"></div> Carregando...</div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/backup/list`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const backups = await response.json();
            displayBackupList(backups);
        } else {
            backupList.innerHTML = '<div class="alert alert-danger">Erro ao carregar backups</div>';
        }
    } catch (error) {
        backupList.innerHTML = '<div class="alert alert-danger">Erro de conexão</div>';
        console.error('Erro:', error);
    }
}

function displayBackupList(backups) {
    const backupList = document.getElementById('backupList');
    
    if (backups.length === 0) {
        backupList.innerHTML = `
            <div class="text-center py-4">
                <i class="fas fa-archive fa-3x mb-3" style="color: rgba(120, 119, 198, 0.5);"></i>
                <h6 style="color: rgba(255,255,255,0.8);">Nenhum backup encontrado</h6>
                <p style="color: rgba(255,255,255,0.6); font-size: 0.9rem;">Crie seu primeiro backup acima</p>
            </div>
        `;
        return;
    }
    
    let html = '<div class="row">';
    
    backups.forEach(backup => {
        const data = new Date(backup.created_at).toLocaleString('pt-BR');
        const tamanho = (backup.size / 1024).toFixed(1);
        
        html += `
            <div class="col-md-6 mb-3">
                <div class="card" style="background: rgba(26, 26, 46, 0.6); border: 1px solid rgba(120, 119, 198, 0.2);">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <h6 class="mb-1" style="color: #fff;">Backup #${backup.id}</h6>
                                <p class="mb-1" style="color: rgba(255,255,255,0.7); font-size: 0.9rem;">
                                    <i class="fas fa-calendar me-1"></i>${data}
                                </p>
                                <small style="color: rgba(255,255,255,0.6);">
                                    <i class="fas fa-database me-1"></i>${tamanho} KB
                                </small>
                            </div>
                            <button class="btn btn-primary btn-sm" onclick="downloadBackup(${backup.id})" title="Baixar backup">
                                <i class="fas fa-download"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    backupList.innerHTML = html;
}

async function downloadBackup(backupId) {
    try {
        const response = await fetch(`${API_BASE_URL}/backup/download/${backupId}`, {
            headers: {
                'Authorization': `Bearer ${authToken}`
            }
        });
        
        if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `backup-${backupId}-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            window.URL.revokeObjectURL(url);
            showAlert('Backup baixado com sucesso!', 'success');
        } else {
            showAlert('Erro ao baixar backup', 'danger');
        }
    } catch (error) {
        showAlert('Erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Funções de sincronização
function exportEstoque() {
    const link = document.createElement('a');
    link.href = `${API_BASE_URL}/estoque/export?token=${authToken}`;
    link.download = 'estoque.json';
    link.click();
    showAlert('Arquivo de estoque baixado! Envie este arquivo para o bot.', 'success');
}

function showImportModal() {
    const modal = new bootstrap.Modal(document.getElementById('importModal'));
    modal.show();
}

async function importEstoque() {
    const fileInput = document.getElementById('importFile');
    const file = fileInput.files[0];
    
    if (!file) {
        showAlert('Selecione um arquivo JSON', 'danger');
        return;
    }
    
    try {
        const text = await file.text();
        const estoque = JSON.parse(text);
        
        const response = await fetch(`${API_BASE_URL}/estoque/import`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ estoque })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showAlert('Estoque importado com sucesso!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('importModal')).hide();
            fileInput.value = '';
            loadEstoque();
        } else {
            showAlert(data.error || 'Erro ao importar estoque', 'danger');
        }
    } catch (error) {
        showAlert('Arquivo inválido ou erro de conexão', 'danger');
        console.error('Erro:', error);
    }
}

// Funções do sistema de vendas
function showSalesModal() {
    const modal = new bootstrap.Modal(document.getElementById('salesModal'));
    loadSalesData();
    modal.show();
}

async function loadSalesData() {
    try {
        // Carregar estatísticas
        const statsResponse = await fetch(`${API_BASE_URL}/sales/stats`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (statsResponse.ok) {
            const stats = await statsResponse.json();
            updateSalesStats(stats);
        }
        
        // Carregar histórico de vendas
        loadSalesHistory();
        loadCustomers();
        loadAnalytics();
    } catch (error) {
        console.error('Erro ao carregar dados de vendas:', error);
    }
}

function updateSalesStats(stats) {
    document.getElementById('totalRevenue').textContent = `R$ ${stats.totalRevenue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('totalSales').textContent = stats.totalSales.toLocaleString();
    document.getElementById('totalCustomers').textContent = stats.totalCustomers.toLocaleString();
    document.getElementById('todayRevenue').textContent = `R$ ${stats.todayRevenue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
}

async function loadSalesHistory() {
    const salesList = document.getElementById('salesHistoryList');
    salesList.innerHTML = '<div class="text-center py-4"><div class="spinner-border"></div><p class="mt-2">Carregando vendas...</p></div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/sales/history`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const sales = await response.json();
            displaySalesHistory(sales);
        } else {
            salesList.innerHTML = '<div class="alert alert-warning">Nenhuma venda encontrada</div>';
        }
    } catch (error) {
        salesList.innerHTML = '<div class="alert alert-danger">Erro ao carregar vendas</div>';
    }
}

function displaySalesHistory(sales) {
    const salesList = document.getElementById('salesHistoryList');
    
    if (sales.length === 0) {
        salesList.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-shopping-cart fa-4x mb-3" style="color: rgba(120, 119, 198, 0.5);"></i>
                <h6 style="color: rgba(255,255,255,0.8);">Nenhuma venda registrada</h6>
                <p style="color: rgba(255,255,255,0.6);">As vendas aparecerão aqui automaticamente</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    sales.forEach(sale => {
        const data = new Date(sale.created_at).toLocaleString('pt-BR');
        html += `
            <div class="sales-item">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="d-flex align-items-center mb-2">
                            <i class="fas fa-user-circle me-2" style="color: #7877c6;"></i>
                            <strong style="color: #fff;">${sale.customer_name}</strong>
                            <span class="badge ms-2" style="background: rgba(120, 119, 198, 0.3);">${sale.customer_id}</span>
                        </div>
                        <div class="mb-2">
                            <i class="fas fa-box me-2" style="color: #ff77c6;"></i>
                            <span style="color: rgba(255,255,255,0.9);">${sale.product_name}</span>
                            <span style="color: rgba(255,255,255,0.6);"> • ${sale.category}</span>
                        </div>
                        <div>
                            <i class="fas fa-clock me-2" style="color: rgba(255,255,255,0.6);"></i>
                            <small style="color: rgba(255,255,255,0.6);">${data}</small>
                        </div>
                    </div>
                    <div class="text-end">
                        <div class="h5 mb-1" style="color: #27ae60;">R$ ${sale.price.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
                        <span class="badge" style="background: #27ae60;">Concluída</span>
                    </div>
                </div>
            </div>
        `;
    });
    
    salesList.innerHTML = html;
}

async function loadCustomers() {
    const customersList = document.getElementById('customersList');
    customersList.innerHTML = '<div class="text-center py-4"><div class="spinner-border"></div><p class="mt-2">Carregando clientes...</p></div>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/sales/customers`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const customers = await response.json();
            displayCustomers(customers);
        } else {
            customersList.innerHTML = '<div class="alert alert-warning">Nenhum cliente encontrado</div>';
        }
    } catch (error) {
        customersList.innerHTML = '<div class="alert alert-danger">Erro ao carregar clientes</div>';
    }
}

function displayCustomers(customers) {
    const customersList = document.getElementById('customersList');
    
    if (customers.length === 0) {
        customersList.innerHTML = `
            <div class="text-center py-5">
                <i class="fas fa-users fa-4x mb-3" style="color: rgba(120, 119, 198, 0.5);"></i>
                <h6 style="color: rgba(255,255,255,0.8);">Nenhum cliente registrado</h6>
                <p style="color: rgba(255,255,255,0.6);">Os clientes aparecerão após as primeiras vendas</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    customers.forEach(customer => {
        const ultimaCompra = new Date(customer.last_purchase).toLocaleDateString('pt-BR');
        html += `
            <div class="customer-item">
                <div class="d-flex justify-content-between align-items-center">
                    <div class="d-flex align-items-center">
                        <div class="customer-avatar me-3">
                            <i class="fas fa-user-circle" style="font-size: 2.5rem; color: #7877c6;"></i>
                        </div>
                        <div>
                            <h6 class="mb-1" style="color: #fff;">${customer.name}</h6>
                            <p class="mb-1" style="color: rgba(255,255,255,0.7); font-size: 0.9rem;">ID: ${customer.customer_id}</p>
                            <small style="color: rgba(255,255,255,0.6);">Última compra: ${ultimaCompra}</small>
                        </div>
                    </div>
                    <div class="text-end">
                        <div class="mb-1">
                            <span class="badge" style="background: #7877c6; margin-right: 5px;">${customer.total_purchases} compras</span>
                        </div>
                        <div class="h6 mb-0" style="color: #27ae60;">R$ ${customer.total_spent.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
                    </div>
                </div>
            </div>
        `;
    });
    
    customersList.innerHTML = html;
}

async function loadAnalytics() {
    try {
        const response = await fetch(`${API_BASE_URL}/sales/analytics`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (response.ok) {
            const analytics = await response.json();
            displayTopProducts(analytics.topProducts);
            displayTopCustomers(analytics.topCustomers);
        }
    } catch (error) {
        console.error('Erro ao carregar analytics:', error);
    }
}

function displayTopProducts(products) {
    const topProducts = document.getElementById('topProducts');
    
    if (products.length === 0) {
        topProducts.innerHTML = '<p style="color: rgba(255,255,255,0.6); text-align: center;">Nenhum dado disponível</p>';
        return;
    }
    
    let html = '';
    products.forEach((product, index) => {
        html += `
            <div class="product-rank">
                <div class="rank-number">${index + 1}</div>
                <div class="rank-info">
                    <div class="rank-name">${product.name}</div>
                    <div class="rank-details">${product.sales_count} vendas</div>
                </div>
                <div class="rank-value">R$ ${product.total_revenue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
            </div>
        `;
    });
    
    topProducts.innerHTML = html;
}

function displayTopCustomers(customers) {
    const topCustomers = document.getElementById('topCustomers');
    
    if (customers.length === 0) {
        topCustomers.innerHTML = '<p style="color: rgba(255,255,255,0.6); text-align: center;">Nenhum dado disponível</p>';
        return;
    }
    
    let html = '';
    customers.forEach((customer, index) => {
        html += `
            <div class="product-rank">
                <div class="rank-number">${index + 1}</div>
                <div class="rank-info">
                    <div class="rank-name">${customer.name}</div>
                    <div class="rank-details">${customer.total_purchases} compras</div>
                </div>
                <div class="rank-value">R$ ${customer.total_spent.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</div>
            </div>
        `;
    });
    
    topCustomers.innerHTML = html;
}

function filterSales() {
    // Implementar filtro de vendas
    loadSalesHistory();
}

function searchCustomers() {
    // Implementar busca de clientes
    loadCustomers();
}

function exportSalesReport() {
    showAlert('Funcionalidade em desenvolvimento', 'info');
}