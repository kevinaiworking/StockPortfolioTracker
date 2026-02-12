// State
let portfolio = JSON.parse(localStorage.getItem('portfolio')) || [];
let stockData = {}; // Cache for stock data
let chartInstance = null;

// DOM Elements
const form = document.getElementById('add-stock-form');
const tableBody = document.querySelector('#portfolio-table tbody');
const totalInvestmentEl = document.getElementById('total-investment');
const currentValueEl = document.getElementById('current-value');
const totalPlEl = document.getElementById('total-pl');
const totalPlPercentEl = document.getElementById('total-pl-percent');
const chartCtx = document.getElementById('stockChart').getContext('2d');
const chartTitle = document.getElementById('chart-title');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    renderTable();
    updateSummary();
    if (portfolio.length > 0) fetchAllData();
});

// Event Listeners
form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ticker = document.getElementById('ticker').value.toUpperCase().trim();
    const quantity = parseFloat(document.getElementById('quantity').value);
    const cost = parseFloat(document.getElementById('cost').value);

    // Basic Validation
    if (ticker && quantity > 0 && cost >= 0) {
        addStock(ticker, quantity, cost);
        form.reset();
    }
});

// Logic
function addStock(symbol, qty, cost) {
    const existing = portfolio.find(s => s.symbol === symbol);
    if (existing) {
        // Update existing position (Weighted Average Cost)
        const totalCostCoordinates = (existing.qty * existing.cost) + (qty * cost);
        const totalQty = existing.qty + qty;
        existing.cost = totalCostCoordinates / totalQty;
        existing.qty = totalQty;
    } else {
        portfolio.push({ symbol, qty, cost });
    }
    saveData();
    renderTable();
    fetchStockData(symbol); // Fetch immediate data for new stock
}

function deleteStock(symbol) {
    portfolio = portfolio.filter(s => s.symbol !== symbol);
    saveData();
    renderTable();
    updateSummary();
}

function saveData() {
    localStorage.setItem('portfolio', JSON.stringify(portfolio));
}

function renderTable() {
    tableBody.innerHTML = '';
    portfolio.forEach(stock => {
        const data = stockData[stock.symbol] || { price: 0, change: 0 };
        const currentPrice = data.price;
        const currentValue = currentPrice > 0 ? currentPrice * stock.qty : 0;
        const totalCost = stock.cost * stock.qty;

        // Only calculate P/L if we have a valid price
        let pl = 0;
        let plClass = 'neutral';

        if (currentPrice > 0) {
            pl = currentValue - totalCost;
            plClass = pl >= 0 ? 'positive' : 'negative';
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${stock.symbol}</td>
            <td>${stock.qty}</td>
            <td>$${stock.cost.toFixed(2)}</td>
            <td>${currentPrice > 0 ? '$' + currentPrice.toFixed(2) : 'Loading...'}</td>
            <td>${currentValue > 0 ? '$' + currentValue.toFixed(2) : '-'}</td>
            <td class="${plClass}">${currentPrice > 0 ? '$' + pl.toFixed(2) : '-'}</td>
            <td><button class="delete-btn" onclick="deleteStock('${stock.symbol}'); event.stopPropagation();">🗑️</button></td>
        `;

        tr.addEventListener('click', () => loadChart(stock.symbol));
        tableBody.appendChild(tr);
    });
}

function updateSummary() {
    let totalInv = 0;
    let currentVal = 0;
    let hasData = false;

    portfolio.forEach(stock => {
        totalInv += stock.qty * stock.cost;
        const price = stockData[stock.symbol] ? stockData[stock.symbol].price : 0;
        if (price > 0) {
            currentVal += stock.qty * price;
            hasData = true;
        }
    });

    const totalPl = currentVal - totalInv;
    const totalPlPercent = totalInv > 0 ? (totalPl / totalInv) * 100 : 0;

    totalInvestmentEl.textContent = `$${totalInv.toFixed(2)}`;
    currentValueEl.textContent = hasData ? `$${currentVal.toFixed(2)}` : 'Loading...';

    if (hasData) {
        totalPlEl.textContent = `$${totalPl.toFixed(2)}`;
        totalPlPercentEl.textContent = `${totalPlPercent.toFixed(2)}%`;
        totalPlEl.className = totalPl >= 0 ? 'positive' : 'negative';
        totalPlPercentEl.className = `pill ${totalPl >= 0 ? 'positive' : 'negative'}`;
    }
}

// Data Fetching Mechanism
// Using Yahoo Finance API via a CORS Proxy to bypass browser restrictions
async function fetchAllData() {
    for (const stock of portfolio) {
        await fetchStockData(stock.symbol);
        // Small delay to be polite to the public API
        await new Promise(r => setTimeout(r, 500));
    }
}

async function fetchStockData(symbol) {
    try {
        // Using corsproxy.io to access Yahoo Finance API
        // This endpoint returns 30 days of data + current price metadata
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1mo`;
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;

        const response = await fetch(proxyUrl);
        const json = await response.json();

        const result = json.chart.result[0];
        const meta = result.meta;
        const currentPrice = meta.regularMarketPrice;
        const previousClose = meta.chartPreviousClose;
        const change = currentPrice - previousClose;

        stockData[symbol] = {
            price: currentPrice,
            change: change,
            // Store history for chart usage later
            history: {
                timestamp: result.timestamp,
                close: result.indicators.quote[0].close
            }
        };

        renderTable();
        updateSummary();

        // If this stock is currently showing in chart, update it
        if (chartTitle.textContent.includes(symbol)) {
            loadChart(symbol);
        }

    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
        // Fallback or error state
    }
}

async function loadChart(symbol) {
    chartTitle.textContent = `${symbol} - 30 Day Trend`;

    // Check if we already have the data
    if (!stockData[symbol] || !stockData[symbol].history) {
        await fetchStockData(symbol);
    }

    const data = stockData[symbol];
    if (!data || !data.history) return;

    const timestamps = data.history.timestamp;
    const prices = data.history.close;

    // Filter out nulls (sometimes happens in API)
    const cleanData = [];
    const cleanLabels = [];

    if (timestamps && prices) {
        for (let i = 0; i < timestamps.length; i++) {
            if (prices[i] !== null && prices[i] !== undefined) {
                const date = new Date(timestamps[i] * 1000);
                cleanLabels.push(`${date.getMonth() + 1}/${date.getDate()}`);
                cleanData.push(prices[i]);
            }
        }
    }

    renderChart(cleanLabels, cleanData);
}

function renderChart(labels, data) {
    if (chartInstance) {
        chartInstance.destroy();
    }

    // Gradient Fill
    const gradient = chartCtx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.5)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    chartInstance = new Chart(chartCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Price ($)',
                data: data,
                borderColor: '#3b82f6',
                backgroundColor: gradient,
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: 'rgba(15, 23, 42, 0.9)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#e2e8f0',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    ticks: { color: '#94a3b8', maxTicksLimit: 6 },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#94a3b8' },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' }
                }
            }
        }
    });

    // Animate Chart Title
    chartTitle.style.opacity = '0';
    setTimeout(() => chartTitle.style.opacity = '1', 100);
}

// Data Management (Import/Export)
const exportBtn = document.getElementById('export-btn');
const importBtn = document.getElementById('import-btn');
const importInput = document.getElementById('import-input');

exportBtn.addEventListener('click', () => {
    if (portfolio.length === 0) {
        alert('No data to export!');
        return;
    }
    const dataStr = JSON.stringify(portfolio, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
});

importBtn.addEventListener('click', () => {
    importInput.click();
});

importInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedData = JSON.parse(event.target.result);
            if (Array.isArray(importedData)) {
                // Validate structure roughly
                const valid = importedData.every(item => item.symbol && item.qty && item.cost);
                if (valid) {
                    if (confirm(`Replace current portfolio with ${importedData.length} items from backup?`)) {
                        portfolio = importedData;
                        saveData();
                        renderTable();
                        updateSummary();
                        fetchAllData(); // Refresh prices for new data
                        alert('Portfolio restored successfully!');
                    }
                } else {
                    alert('Invalid file format: Missing required fields.');
                }
            } else {
                alert('Invalid file format: Not a list of stocks.');
            }
        } catch (error) {
            console.error(error);
            alert('Error parsing JSON file.');
        }
        // Reset input so same file can be selected again
        importInput.value = '';
    };
    reader.readAsText(file);
});
