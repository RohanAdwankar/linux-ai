const windowBar = document.getElementById("window-bar");
const statsNode = document.getElementById("stats");
const subsystemNode = document.getElementById("subsystems");
const agentNode = document.getElementById("agents");
const timelineNode = document.getElementById("timeline");
const commitsNode = document.getElementById("commits");
const generatedAtNode = document.getElementById("generated-at");
const timelineLabelNode = document.getElementById("timeline-label");
const commitsTitleNode = document.getElementById("commits-title");
const commitsSubtitleNode = document.getElementById("commits-subtitle");
const clearFilterButton = document.getElementById("clear-filter");

const WINDOWS = [
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "365d", label: "1y", days: 365 },
  { key: "all", label: "all", days: null },
];

const STACK_COLORS = {
  claude: ["#1f1f1f", "#5a5a55", "#8c8c84", "#b8b8af", "#d9d9d0"],
  gemini: ["#202020", "#4e5a63", "#788793", "#a1b1bd", "#cad4db"],
  other: ["#2d2d2d", "#686861", "#9b9b94", "#c8c8c0"],
};
const PAGE_SIZE = 5;

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function formatDate(value) {
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
  });
}

function joinedVariantSummary(variants) {
  const names = variants.map((variant) => variant.identity);
  if (names.join(", ").length <= 72) {
    return names.join(", ");
  }

  const visible = [];
  let currentLength = 0;
  for (const name of names) {
    const nextLength = currentLength === 0 ? name.length : currentLength + 2 + name.length;
    if (nextLength > 60) break;
    visible.push(name);
    currentLength = nextLength;
  }

  if (!visible.length) {
    return `${names[0]}...`;
  }
  return `${visible.join(", ")}...`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function windowedCommits(commits, windowOption) {
  if (!windowOption.days) return commits;
  const latest = commits[0];
  if (!latest) return [];
  const cutoff = new Date(latest.authoredAt).getTime() - windowOption.days * 24 * 60 * 60 * 1000;
  return commits.filter((commit) => new Date(commit.authoredAt).getTime() >= cutoff);
}

function assistantFamilyName(identity) {
  const lower = String(identity || "").toLowerCase();
  if (lower.includes("claude")) return "claude";
  if (lower.includes("gemini")) return "gemini";
  return String(identity || "").split(":")[0].toLowerCase();
}

function assistantPalette(family) {
  return STACK_COLORS[family] || STACK_COLORS.other;
}

function summarize(commits) {
  const subsystemMap = new Map();
  const familyMap = new Map();
  const authorSet = new Set();

  for (const commit of commits) {
    authorSet.add(commit.authorName);

    const subsystem = subsystemMap.get(commit.subsystem) || {
      name: commit.subsystem,
      count: 0,
      latestAt: commit.authoredAt,
      authors: new Set(),
    };
    subsystem.count += 1;
    subsystem.authors.add(commit.authorName);
    if (new Date(commit.authoredAt) > new Date(subsystem.latestAt)) {
      subsystem.latestAt = commit.authoredAt;
    }
    subsystemMap.set(commit.subsystem, subsystem);

    for (const agent of commit.assistedBy || []) {
      const familyName = assistantFamilyName(agent.identity);
      const family = familyMap.get(familyName) || {
        name: familyName,
        count: 0,
        variants: new Map(),
      };
      family.count += 1;

      const variant = family.variants.get(agent.identity) || {
        identity: agent.identity,
        agent: agent.agent,
        model: agent.model,
        count: 0,
      };
      variant.count += 1;
      family.variants.set(agent.identity, variant);
      familyMap.set(familyName, family);
    }
  }

  return {
    totalCommits: commits.length,
    totalSubsystems: subsystemMap.size,
    totalAuthors: authorSet.size,
    totalAssistantFamilies: familyMap.size,
    subsystems: [...subsystemMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    assistantFamilies: [...familyMap.values()]
      .map((family) => ({
        ...family,
        variants: [...family.variants.values()].sort((a, b) => b.count - a.count || a.identity.localeCompare(b.identity)),
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

function buildTimeline(commits, windowOption) {
  if (!commits.length) return [];
  const counts = new Map();
  const ordered = [...commits].sort((a, b) => new Date(a.authoredAt) - new Date(b.authoredAt));
  const latestDate = new Date(ordered[ordered.length - 1].authoredAt);
  const monthLimit = windowOption.days ? Math.min(12, Math.ceil(windowOption.days / 30) + 1) : 18;
  const firstMonth = startOfMonth(latestDate);
  firstMonth.setUTCMonth(firstMonth.getUTCMonth() - (monthLimit - 1));

  for (const commit of ordered) {
    const key = monthKey(startOfMonth(new Date(commit.authoredAt)));
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const buckets = [];
  const cursor = new Date(firstMonth);
  for (let index = 0; index < monthLimit; index += 1) {
    const key = monthKey(cursor);
    buckets.push({
      key,
      label: monthLabel(key),
      count: counts.get(key) || 0,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return buckets;
}

function renderStats(summary, commits) {
  const latest = commits[0];
  const recent30 = summarize(windowedCommits(commits, WINDOWS[0])).totalCommits;
  const topSubsystem = summary.subsystems[0];
  const topAssistant = summary.assistantFamilies[0];

  statsNode.innerHTML = [
    {
      label: "assisted commits",
      value: formatNumber(summary.totalCommits),
      note: latest ? `latest on ${formatDate(latest.authoredAt)}` : "no commits found",
    },
    {
      label: "last 30 days",
      value: formatNumber(recent30),
      note: "rolling activity window",
    },
    {
      label: "subsystems",
      value: formatNumber(summary.totalSubsystems),
      note: topSubsystem ? `leader: ${topSubsystem.name}` : "no subsystem data",
    },
    {
      label: "assistant families",
      value: formatNumber(summary.totalAssistantFamilies),
      note: topAssistant ? `most used: ${topAssistant.name}` : "no assistant data",
    },
  ]
    .map(
      (item) => `
        <article class="stat">
          <div class="stat-label">${escapeHtml(item.label)}</div>
          <div class="stat-value">${escapeHtml(item.value)}</div>
          <div class="stat-note">${escapeHtml(item.note)}</div>
        </article>
      `,
    )
    .join("");
}

function pageCount(items) {
  return Math.max(1, Math.ceil(items.length / PAGE_SIZE));
}

function pagedItems(items, page) {
  const safePage = Math.max(0, Math.min(page, pageCount(items) - 1));
  return items.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
}

function renderPager(items, page, key) {
  if (items.length <= PAGE_SIZE) return "";
  const totalPages = pageCount(items);
  return `
    <div class="pager" data-pager="${escapeHtml(key)}">
      ${Array.from({ length: totalPages }, (_, index) => `
        <button class="pager-button ${index === page ? "active" : ""}" data-pager="${escapeHtml(key)}" data-page="${index + 1}">
          ${index + 1}
        </button>
      `).join("")}
    </div>
  `;
}

function bindPager(node, key, onPageChange) {
  for (const button of node.querySelectorAll(`[data-pager='${key}'][data-page]`)) {
    button.addEventListener("click", () => {
      onPageChange(Number(button.dataset.page) - 1);
    });
  }
}

function renderSubsystems(node, items, activeFilter, page, onSelect, onPageChange) {
  if (!items.length) {
    node.innerHTML = `<div class="status">no subsystem data for this window.</div>`;
    return;
  }
  const maxCount = items[0].count || 1;
  node.innerHTML = pagedItems(items, page)
    .map(
      (item) => `
        <button class="row row-button ${activeFilter?.type === "subsystem" && activeFilter.value === item.name ? "is-selected" : ""}" data-filter-type="subsystem" data-filter-value="${escapeHtml(item.name)}">
          <div class="row-copy">
            <div class="row-title">${escapeHtml(item.name)}</div>
            <div class="row-meta">${escapeHtml(`${item.authors.size} authors • latest ${formatDate(item.latestAt)}`)}</div>
            <div class="row-line"><div class="row-fill" style="width:${Math.max(6, (item.count / maxCount) * 100)}%"></div></div>
          </div>
          <div class="row-value">${formatNumber(item.count)}</div>
        </button>
      `,
    )
    .join("") + renderPager(items, page, "subsystems");

  for (const button of node.querySelectorAll("[data-filter-type='subsystem']")) {
    button.addEventListener("click", () => {
      onSelect({ type: "subsystem", value: button.dataset.filterValue });
    });
  }
  bindPager(node, "subsystems", onPageChange);
}

function renderAssistantFamilies(node, families, activeFilter, page, onSelect, onPageChange) {
  if (!families.length) {
    node.innerHTML = `<div class="status">no assistant identities found for this window.</div>`;
    return;
  }
  node.innerHTML = pagedItems(families, page)
    .map((family) => {
      const palette = assistantPalette(family.name);
      const detail = joinedVariantSummary(family.variants);
      return `
        <div class="stack-card ${activeFilter?.type === "assistant-family" && activeFilter.value === family.name ? "is-selected" : ""}">
          <button class="stack-head" data-filter-type="assistant-family" data-filter-value="${escapeHtml(family.name)}">
            <span class="row-title">${escapeHtml(family.name)}</span>
            <span class="row-value">${formatNumber(family.count)}</span>
          </button>
          <div class="row-meta stack-summary">${escapeHtml(`${family.variants.length} variants clustered together`)}</div>
          <div class="stack-bar" role="img" aria-label="${escapeHtml(`${family.name} usage stack`)}">
            ${family.variants
              .map((variant, index) => {
                const width = (variant.count / family.count) * 100;
                const color = palette[index % palette.length];
                const selected =
                  activeFilter?.type === "assistant-identity" && activeFilter.value === variant.identity ? "is-selected" : "";
                return `
                  <button
                    class="stack-segment ${selected}"
                    style="width:${width}%; background:${color}"
                    data-filter-type="assistant-identity"
                    data-filter-value="${escapeHtml(variant.identity)}"
                    data-detail="${escapeHtml(`${variant.identity} • ${variant.count} commits`)}"
                    title="${escapeHtml(`${variant.identity} • ${variant.count} commits`)}"
                  ></button>
                `;
              })
              .join("")}
          </div>
          <div class="stack-detail" data-default-detail="${escapeHtml(detail)}">${escapeHtml(detail)}</div>
        </div>
      `;
    })
    .join("") + renderPager(families, page, "assistants");

  for (const button of node.querySelectorAll("[data-filter-type='assistant-family']")) {
    button.addEventListener("click", () => {
      onSelect({ type: "assistant-family", value: button.dataset.filterValue });
    });
  }

  for (const segment of node.querySelectorAll("[data-filter-type='assistant-identity']")) {
    const card = segment.closest(".stack-card");
    const detail = card.querySelector(".stack-detail");
    const fallbackText = detail.dataset.defaultDetail;
    segment.addEventListener("mouseenter", () => {
      detail.textContent = segment.dataset.detail;
    });
    segment.addEventListener("mouseleave", () => {
      detail.textContent = fallbackText;
    });
    segment.addEventListener("focus", () => {
      detail.textContent = segment.dataset.detail;
    });
    segment.addEventListener("blur", () => {
      detail.textContent = fallbackText;
    });
    segment.addEventListener("click", () => {
      onSelect({ type: "assistant-identity", value: segment.dataset.filterValue });
    });
  }
  bindPager(node, "assistants", onPageChange);
}

function renderTimeline(buckets) {
  if (!buckets.length) {
    timelineNode.innerHTML = `<div class="status">no timeline available for this window.</div>`;
    return;
  }
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 1);
  timelineNode.innerHTML = buckets
    .map(
      (bucket) => `
        <div class="timeline-bar">
          <div class="timeline-column">
            <div class="timeline-fill" style="height:${Math.max(0, (bucket.count / maxCount) * 100)}%"></div>
          </div>
          <div class="timeline-meta"><strong>${formatNumber(bucket.count)}</strong>${escapeHtml(bucket.label)}</div>
        </div>
      `,
    )
    .join("");
}

function filteredCommits(commits, filter) {
  if (!filter) return commits;
  if (filter.type === "subsystem") {
    return commits.filter((commit) => commit.subsystem === filter.value);
  }
  if (filter.type === "assistant-family") {
    return commits.filter((commit) => (commit.assistedBy || []).some((agent) => assistantFamilyName(agent.identity) === filter.value));
  }
  if (filter.type === "assistant-identity") {
    return commits.filter((commit) => (commit.assistedBy || []).some((agent) => agent.identity === filter.value));
  }
  return commits;
}

function filterCopy(filter) {
  if (!filter) {
    return {
      title: "recent assisted commits",
      subtitle: "latest Linux kernel commits with explicit ai attribution.",
    };
  }
  if (filter.type === "subsystem") {
    return {
      title: `commits for subsystem: ${filter.value}`,
      subtitle: "filtered from the current window selection.",
    };
  }
  if (filter.type === "assistant-family") {
    return {
      title: `commits for assistant family: ${filter.value}`,
      subtitle: "all identities containing that family name.",
    };
  }
  return {
    title: `commits for assistant identity: ${filter.value}`,
    subtitle: "filtered to the exact assisted-by string.",
  };
}

function renderCommits(commits, filter, onClear, onSelect) {
  const copy = filterCopy(filter);
  commitsTitleNode.textContent = copy.title;
  commitsSubtitleNode.textContent = copy.subtitle;
  clearFilterButton.hidden = !filter;
  clearFilterButton.onclick = onClear;

  if (!commits.length) {
    commitsNode.innerHTML = `<div class="status">no commits found for this filter.</div>`;
    return;
  }

  commitsNode.innerHTML = commits
    .slice(0, 24)
    .map((commit) => {
      const tags = [
        { type: "subsystem", value: commit.subsystem, label: commit.subsystem },
        ...(commit.assistedBy || []).map((agent) => agent.identity),
      ].map((item) =>
        typeof item === "string" ? { type: "assistant-identity", value: item, label: item } : item,
      );
      return `
        <article class="commit">
          <div>
            <a class="commit-title" href="${escapeHtml(commit.htmlUrl)}" target="_blank" rel="noreferrer">${escapeHtml(commit.subject)}</a>
            <div class="commit-meta">${escapeHtml(commit.authorName)} committed ${escapeHtml(commit.sha.slice(0, 12))} on ${escapeHtml(formatDate(commit.authoredAt))}</div>
          </div>
          <div class="commit-tags">
            ${tags
              .map(
                (tag) => `
                  <button class="tag ${filter?.type === tag.type && filter.value === tag.value ? "is-selected" : ""}" data-filter-type="${escapeHtml(tag.type)}" data-filter-value="${escapeHtml(tag.value)}">${escapeHtml(tag.label)}</button>
                `,
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");

  for (const button of commitsNode.querySelectorAll("[data-filter-type]")) {
    button.addEventListener("click", () => {
      onSelect({ type: button.dataset.filterType, value: button.dataset.filterValue });
    });
  }
}

function render(data, currentWindow, activeFilter, pages, setFilter, setPage) {
  const commits = windowedCommits(data.commits, currentWindow);
  const summary = summarize(commits);
  const matchingCommits = filteredCommits(commits, activeFilter);

  generatedAtNode.textContent = `snapshot updated ${new Date(data.generatedAt).toLocaleString()}.`;
  timelineLabelNode.textContent = currentWindow.days
    ? `recent history across the last ${currentWindow.days} days.`
    : "most recent 18 monthly buckets.";

  renderStats(summary, data.commits);
  renderSubsystems(
    subsystemNode,
    summary.subsystems,
    activeFilter,
    Math.min(pages.subsystems, pageCount(summary.subsystems) - 1),
    (nextFilter) => {
      setFilter(nextFilter);
      commitsNode.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    (nextPage) => setPage("subsystems", nextPage),
  );
  renderAssistantFamilies(
    agentNode,
    summary.assistantFamilies,
    activeFilter,
    Math.min(pages.assistants, pageCount(summary.assistantFamilies) - 1),
    (nextFilter) => {
      setFilter(nextFilter);
      commitsNode.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    (nextPage) => setPage("assistants", nextPage),
  );
  renderTimeline(buildTimeline(commits, currentWindow));
  renderCommits(
    matchingCommits,
    activeFilter,
    () => setFilter(null),
    (nextFilter) => setFilter(nextFilter),
  );
}

async function init() {
  const response = await fetch("./data/adoption.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("snapshot missing");
  }
  const data = await response.json();
  let currentWindow = WINDOWS[1];
  let activeFilter = null;
  let pages = { subsystems: 0, assistants: 0 };

  const rerender = () => {
    windowBar.innerHTML = "";
    for (const option of WINDOWS) {
      const button = document.createElement("button");
      button.textContent = option.label;
      if (option.key === currentWindow.key) button.classList.add("active");
      button.addEventListener("click", () => {
        currentWindow = option;
        activeFilter = null;
        pages = { subsystems: 0, assistants: 0 };
        rerender();
      });
      windowBar.appendChild(button);
    }

    render(
      data,
      currentWindow,
      activeFilter,
      pages,
      (nextFilter) => {
        activeFilter =
          activeFilter && nextFilter && activeFilter.type === nextFilter.type && activeFilter.value === nextFilter.value
            ? null
            : nextFilter;
        rerender();
      },
      (key, nextPage) => {
        pages = { ...pages, [key]: nextPage };
        rerender();
      },
    );
  };

  rerender();
}

init().catch(() => {
  generatedAtNode.textContent = "no snapshot available.";
  statsNode.innerHTML = `<div class="status">unable to load adoption data.</div>`;
  subsystemNode.innerHTML = `<div class="status">unable to load adoption data.</div>`;
  agentNode.innerHTML = `<div class="status">unable to load adoption data.</div>`;
  timelineNode.innerHTML = `<div class="status">unable to load adoption data.</div>`;
  commitsNode.innerHTML = `<div class="status">unable to load adoption data.</div>`;
});
