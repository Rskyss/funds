export function renderNavChart(container, navHistory) {
  if (!container) return;
  container.innerHTML = "";
  if (!navHistory || navHistory.length < 2) {
    container.innerHTML = '<p class="hint">暂无足够的历史净值，系统每日自动更新后会逐渐积累。</p>';
    return;
  }

  const points = navHistory.filter((p) => Number.isFinite(p.nav));
  if (points.length < 2) {
    container.innerHTML = '<p class="hint">历史净值数据不足，无法绘图。</p>';
    return;
  }

  const navs = points.map((p) => p.nav);
  const minNav = Math.min(...navs);
  const maxNav = Math.max(...navs);
  const padding = (maxNav - minNav) * 0.1 || maxNav * 0.02 || 0.01;
  const yMin = minNav - padding;
  const yMax = maxNav + padding;

  const W = 640;
  const H = 220;
  const padLeft = 50;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 30;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;

  const xAt = (i) => padLeft + (points.length === 1 ? plotW / 2 : (i * plotW) / (points.length - 1));
  const yAt = (v) => padTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const plottedPoints = points.map((p, i) => ({
    ...p,
    x: xAt(i),
    y: yAt(p.nav),
    changePct: ((p.nav - points[0].nav) / points[0].nav) * 100,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(2)} ${yAt(p.nav).toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L ${xAt(points.length - 1).toFixed(2)} ${padTop + plotH} L ${xAt(0).toFixed(2)} ${padTop + plotH} Z`;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
    const v = yMin + ((yMax - yMin) * i) / ticks;
    return { value: v, y: yAt(v) };
  });

  const xLabels = [];
  const xTickIdxs = [0, Math.floor(points.length / 4), Math.floor(points.length / 2), Math.floor((3 * points.length) / 4), points.length - 1];
  for (const idx of xTickIdxs) {
    if (points[idx]) xLabels.push({ x: xAt(idx), label: points[idx].date });
  }

  const trend = points[points.length - 1].nav - points[0].nav;
  const trendPct = (trend / points[0].nav) * 100;
  const trendColor = trend >= 0 ? "#16a34a" : "#dc2626";

  const svg = `
    <div class="nav-chart-stage">
      <svg viewBox="0 0 ${W} ${H}" class="nav-chart" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="navAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${trendColor}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${trendColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${yTicks.map((t) => `
        <line x1="${padLeft}" x2="${W - padRight}" y1="${t.y.toFixed(2)}" y2="${t.y.toFixed(2)}" stroke="#e5e7eb" stroke-width="1"/>
        <text x="${padLeft - 6}" y="${t.y.toFixed(2)}" font-size="10" fill="#6b7280" text-anchor="end" dominant-baseline="middle">${t.value.toFixed(3)}</text>
      `).join("")}
      <path d="${areaPath}" fill="url(#navAreaGrad)" stroke="none"/>
      <path d="${linePath}" fill="none" stroke="${trendColor}" stroke-width="2"/>
      ${xLabels.map((t) => `
        <text x="${t.x.toFixed(2)}" y="${H - 8}" font-size="10" fill="#6b7280" text-anchor="middle">${escapeHtml(t.label)}</text>
      `).join("")}
      <g class="nav-chart-hover" style="display:none;color:${trendColor}">
        <line class="nav-chart-crosshair-x" x1="${padLeft}" x2="${W - padRight}" y1="0" y2="0"/>
        <line class="nav-chart-crosshair-y" x1="0" x2="0" y1="${padTop}" y2="${padTop + plotH}"/>
        <circle class="nav-chart-point-ring" r="5"/>
        <circle class="nav-chart-point-dot" r="2.5"/>
      </g>
      <rect x="${padLeft}" y="${padTop}" width="${plotW}" height="${plotH}" fill="transparent"/>
      </svg>
      <div class="nav-chart-tooltip" role="status"></div>
    </div>
    <div class="chart-meta">
      <span>区间 ${escapeHtml(points[0].date)} → ${escapeHtml(points[points.length - 1].date)}</span>
      <span style="color:${trendColor}">${trend >= 0 ? "+" : ""}${trendPct.toFixed(2)}%</span>
      <span>${points.length} 个数据点</span>
    </div>
  `;

  container.innerHTML = svg;
  bindChartHover(container, plottedPoints, { W, padLeft, padRight, padTop, plotH });
}

function bindChartHover(container, points, bounds) {
  const stage = container.querySelector(".nav-chart-stage");
  const svg = container.querySelector(".nav-chart");
  const hoverLayer = container.querySelector(".nav-chart-hover");
  const tooltip = container.querySelector(".nav-chart-tooltip");
  const crosshairX = container.querySelector(".nav-chart-crosshair-x");
  const crosshairY = container.querySelector(".nav-chart-crosshair-y");
  const ring = container.querySelector(".nav-chart-point-ring");
  const dot = container.querySelector(".nav-chart-point-dot");
  if (!stage || !svg || !hoverLayer || !tooltip || !crosshairX || !crosshairY || !ring || !dot) return;

  const showPoint = (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const svgX = ((event.clientX - rect.left) / rect.width) * bounds.W;
    const point = nearestPoint(points, svgX, bounds);
    if (!point) return;

    hoverLayer.style.display = "";
    crosshairX.setAttribute("y1", point.y.toFixed(2));
    crosshairX.setAttribute("y2", point.y.toFixed(2));
    crosshairY.setAttribute("x1", point.x.toFixed(2));
    crosshairY.setAttribute("x2", point.x.toFixed(2));
    ring.setAttribute("cx", point.x.toFixed(2));
    ring.setAttribute("cy", point.y.toFixed(2));
    dot.setAttribute("cx", point.x.toFixed(2));
    dot.setAttribute("cy", point.y.toFixed(2));

    const changeClass = point.changePct >= 0 ? "up" : "down";
    tooltip.innerHTML = `
      <strong>${escapeHtml(point.date)}</strong>
      <span>单位净值 ${formatNav(point.nav)}</span>
      <span class="${changeClass}">区间涨跌 ${point.changePct >= 0 ? "+" : ""}${point.changePct.toFixed(2)}%</span>
    `;
    positionTooltip(stage, tooltip, event);
  };

  const hidePoint = () => {
    hoverLayer.style.display = "none";
    tooltip.classList.remove("visible");
  };

  svg.addEventListener("pointermove", showPoint);
  svg.addEventListener("pointerdown", showPoint);
  svg.addEventListener("pointerleave", hidePoint);
  svg.addEventListener("pointercancel", hidePoint);
}

function nearestPoint(points, svgX, bounds) {
  const clampedX = Math.max(bounds.padLeft, Math.min(bounds.W - bounds.padRight, svgX));
  let nearest = points[0];
  let minDistance = Math.abs(points[0].x - clampedX);
  for (let i = 1; i < points.length; i += 1) {
    const distance = Math.abs(points[i].x - clampedX);
    if (distance < minDistance) {
      nearest = points[i];
      minDistance = distance;
    }
  }
  return nearest;
}

function positionTooltip(stage, tooltip, event) {
  const rect = stage.getBoundingClientRect();
  tooltip.classList.add("visible");

  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const tooltipW = tooltip.offsetWidth;
  const tooltipH = tooltip.offsetHeight;
  let left = x + 12;
  let top = y - tooltipH - 14;

  if (left + tooltipW > rect.width - 8) left = x - tooltipW - 12;
  if (top < 8) top = y + 14;

  const maxTop = Math.max(8, rect.height - tooltipH - 8);
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, Math.min(maxTop, top))}px`;
}

function formatNav(value) {
  return Number.isFinite(value) ? value.toFixed(4) : "--";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
