const POPULAR_SYMBOLS = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "TSLA",
  "NVDA",
  "META",
  "BRK.B",
  "JPM",
  "V",
  "JNJ",
  "UNH",
  "WMT",
  "PG",
  "MA",
  "HD",
  "DIS",
  "PYPL",
  "BAC",
  "VZ",
  "CMCSA",
  "ADBE",
  "NFLX",
  "KO",
  "NKE",
  "MRK",
  "PEP",
  "PFE",
  "INTC",
  "CSCO",
];

async function fetchWithRetry(originalUrl, retries = 4) {
  const proxies = [
    "https://corsproxy.io/?",
    "https://api.allorigins.win/raw?url=",
  ];
  for (let i = 0; i < retries; i++) {
    const proxy = proxies[i % proxies.length];
    try {
      const proxyUrl = proxy + encodeURIComponent(originalUrl);
      const response = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        throw new Error(`Response not ok: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (i === retries - 1) {
        throw new Error("Failed to load – try again or check connection.");
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function fetchTopPicks() {
  const topPicksDiv = document.getElementById("topPicks");
  topPicksDiv.innerHTML =
    '<span class="loading">Refreshing latest picks...</span>';

  try {
    const picks = [];
    for (const symbol of POPULAR_SYMBOLS) {
      try {
        const quoteData = await fetchWithRetry(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`
        );
        const historyData = await fetchWithRetry(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1mo&interval=1d`
        );
        if (!quoteData.chart || !quoteData.chart.result || !historyData.chart || !historyData.chart.result) continue;

        const meta = quoteData.chart.result[0].meta;
        const prices = historyData.chart.result[0].indicators.quote[0].close.filter(p => p !== null);
        const volume = (historyData.chart.result[0].indicators.quote[0].volume.reduce((a, b) => a + b, 0) / prices.length).toLocaleString();
        const currentPrice = meta.regularMarketPrice || meta.chartPreviousClose || meta.previousClose;
        const previousClose = meta.previousClose || currentPrice;
        const percentGain = ((currentPrice - previousClose) / previousClose) * 100;
        const formattedGain = percentGain >= 0 ? `+${percentGain.toFixed(2)}%` : `${percentGain.toFixed(2)}%`;

        const tdScore = computeTDSequential(prices).length;
        const pickScore = percentGain + (parseInt(volume.replace(/,/g, '')) / 1000000) + tdScore;

        picks.push({ symbol, formattedGain, volume, tdScore, pickScore });
      } catch (e) {
        // Silent skip
      }
    }
    picks.sort((a, b) => b.pickScore - a.pickScore);
    const top10 = picks.slice(0, 10);

    if (top10.length === 0) {
      topPicksDiv.innerHTML =
        '<span class="error">Quiet market right now – try during trading hours for more action!</span>';
      return;
    }

    topPicksDiv.innerHTML =
      "<p>Top Picks (Ranked by Gain + Volume + TD Strength; TD Score: Higher = More Signals)</p><ul>" +
      top10
        .map(
          (p) =>
            `<li>${p.symbol}: ${p.formattedGain} gain, Vol: ${p.volume}, TD Score: ${p.tdScore}</li>`
        )
        .join("") +
      "</ul>";
  } catch (error) {
    topPicksDiv.innerHTML =
      '<span class="error">Picks refresh failed – try the button again!</span>';
  }
}

async function fetchAndRunAlgorithm() {
  const symbol = document.getElementById("symbol").value.trim().toUpperCase();
  const outputDiv = document.getElementById("output");
  outputDiv.innerHTML = '<span class="loading">Analyzing...</span>';

  if (!symbol) {
    outputDiv.innerHTML = '<span class="error">Please enter a symbol like AAPL.</span>';
    return;
  }

  try {
    const data = await fetchWithRetry(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=6mo&interval=1d`
    );
    if (!data.chart || !data.chart.result) {
      throw new Error("No data found – try a popular symbol like TSLA!");
    }
    const closes = data.chart.result[0].indicators.quote[0].close || [];
    const prices = closes.filter((p) => p !== null && !isNaN(p));
    if (prices.length < 22) {
      throw new Error(
        "Not enough data – try a stock with more history!"
      );
    }

    const signals = computeTDSequential(prices);
    const rsi = calculateRSI(prices.slice(-14));
    const rsiSignal = rsi > 70 ? "Overbought (Consider Selling)" : rsi < 30 ? "Oversold (Consider Buying)" : "Neutral (Hold Steady)";
    const shortSMA = calculateSMA(prices, 50);
    const longSMA = calculateSMA(prices, 200);
    const smaSignal = shortSMA > longSMA ? "Buy (Bullish Trend)" : "Sell (Bearish Trend)";

    let output = `<strong>Analysis for ${symbol}:</strong><br>`;
    output += signals.length > 0 ? signals.join("<br>") + "<br><br>" : "No TD signals – try a volatile stock for more action!<br><br>";
    output += `RSI: ${rsi.toFixed(2)} (${rsiSignal})<br>`;
    output += `SMA Crossover: ${smaSignal}`;
    outputDiv.innerHTML = output;
  } catch (error) {
    outputDiv.innerHTML =
      '<span class="error">' + error.message + "</span>";
  }
}

function resetOutputs() {
  document.getElementById("topPicks").innerHTML =
    '<span class="loading">Ready to refresh...</span>';
  document.getElementById("output").innerHTML = "";
  document.getElementById("symbol").value = "";
  document.getElementById("symbol").focus();
}

function computeTDSequential(prices) {
  const signals = [];

  function isLowerClose(i) {
    return i >= 4 && prices[i] < prices[i - 4];
  }

  function isHigherClose(i) {
    return i >= 4 && prices[i] > prices[i - 4];
  }

  let setupCount = 0;
  let isBuySetup = false;
  let isSellSetup = false;
  let countdown = 0;
  let inCountdown = false;
  let countdownType = null;

  for (let i = 0; i < prices.length; i++) {
    if (!inCountdown) {
      if (isLowerClose(i)) {
        setupCount = isBuySetup ? setupCount + 1 : 1;
        isBuySetup = true;
        isSellSetup = false;
      } else if (isHigherClose(i)) {
        setupCount = isSellSetup ? setupCount + 1 : 1;
        isSellSetup = true;
        isBuySetup = false;
      } else {
        setupCount = 0;
        isBuySetup = false;
        isSellSetup = false;
      }

      if (setupCount >= 9) {
        inCountdown = true;
        countdownType = isBuySetup ? "buy" : "sell";
        countdown = 0;
        signals.push(
          `Setup complete at day ${i + 1}: ` +
            `${countdownType.toUpperCase()} phase`
        );
      }
    }

    if (inCountdown) {
      if (
        (countdownType === "buy" &&
          i >= 2 &&
          prices[i] < prices[i - 2]) ||
        (countdownType === "sell" &&
          i >= 2 &&
          prices[i] > prices[i - 2])
      ) {
        countdown++;
      }

      if (countdown >= 13) {
        signals.push(
          `Signal activated at day ${i + 1}: ` +
            `${countdownType.toUpperCase()} - ` +
            `${countdownType === "buy" ? "BUY" : "SELL"} sustainably!`
        );
        inCountdown = false;
        setupCount = 0;
        isBuySetup = false;
        isSellSetup = false;
      }
    }
  }

  return signals;
}

function calculateRSI(prices) {
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calculateSMA(prices, period) {
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// For main page auto-load
if (document.getElementById("topPicks")) {
  fetchTopPicks();
  setInterval(fetchTopPicks, 300000); // 5 min
}
