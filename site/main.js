const windowBar = document.getElementById("window-bar");
const statsNode = document.getElementById("stats");
const subsystemNode = document.getElementById("subsystems");
const agentNode = document.getElementById("agents");
const timelineNode = document.getElementById("timeline");
const commitsNode = document.getElementById("commits");
const generatedAtNode = document.getElementById("generated-at");
const timelineLabelNode = document.getElementById("timeline-label");

const WINDOWS = [
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "365d", label: "1Y", days: 365 },
  { key: "all", label: "All", days: null },
];

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
    year: "2-digit",
  });
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

function summarize(commits) {
  const subsystemMap = new Map();
  const agentMap = new Map();
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
      const entry = agentMap.get(agent.identity) || {
        identity: agent.identity,
        name: agent.agent,
        model: agent.model,
        count: 0,
      };
      entry.count += 1;
      agentMap.set(agent.identity, entry);
    }
  }

  return {
    totalCommits: commits.length,
    totalSubsystems: subsystemMap.size,
    totalAuthors: authorSet.size,
    totalAgents: agentMap.size,
    subsystems: [...subsystemMap.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    agents: [...agentMap.values()].sort((a, b) => b.count - a.count || a.identity.localeCompare(b.identity)),
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
  const topAgent = summary.agents[0];

  statsNode.innerHTML = [
    {
      label: "Assisted commits",
      value: formatNumber(summary.totalCommits),
      note: latest ? `Latest on ${formatDate(latest.authoredAt)}` : "No commits found",
    },
    {
      label: "Last 30 days",
      value: formatNumber(recent30),
      note: "Rolling activity window",
    },
    {
      label: "Subsystems",
      value: formatNumber(summary.totalSubsystems),
      note: topSubsystem ? `Leader: ${topSubsystem.name}` : "No subsystem data",
    },
    {
      label: "Assistant identities",
      value: formatNumber(summary.totalAgents),
      note: topAgent ? `Most used: ${topAgent.identity}` : "No assistant data",
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

function renderRankedList(node, items, emptyCopy, metaBuilder) {
  if (!items.length) {
    node.innerHTML = `<div class="status">${escapeHtml(emptyCopy)}</div>`;
    return;
  }
  const maxCount = items[0].count || 1;
  node.innerHTML = items
    .slice(0, 12)
    .map(
      (item) => `
        <div class="row">
          <div class="row-copy">
            <div class="row-title">${escapeHtml(item.name || item.identity)}</div>
            <div class="row-meta">${escapeHtml(metaBuilder(item))}</div>
            <div class="row-line"><div class="row-fill" style="width:${Math.max(6, (item.count / maxCount) * 100)}%"></div></div>
          </div>
          <div class="row-value">${formatNumber(item.count)}</div>
        </div>
      `,
    )
    .join("");
}

function renderTimeline(buckets) {
  if (!buckets.length) {
    timelineNode.innerHTML = `<div class="status">No timeline available for this window.</div>`;
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

function renderCommits(commits) {
  if (!commits.length) {
    commitsNode.innerHTML = `<div class="status">No commits found in this window.</div>`;
    return;
  }
  commitsNode.innerHTML = commits
    .slice(0, 18)
    .map((commit) => {
      const tags = [
        commit.subsystem,
        formatDate(commit.authoredAt),
        ...(commit.assistedBy || []).map((agent) => agent.identity),
      ];
      return `
        <article class="commit">
          <div>
            <a class="commit-title" href="${escapeHtml(commit.htmlUrl)}" target="_blank" rel="noreferrer">${escapeHtml(commit.subject)}</a>
            <div class="commit-meta">${escapeHtml(commit.authorName)} committed ${escapeHtml(commit.sha.slice(0, 12))}</div>
          </div>
          <div class="commit-tags">
            ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function render(data, currentWindow) {
  const commits = windowedCommits(data.commits, currentWindow);
  const summary = summarize(commits);

  generatedAtNode.textContent = `Snapshot updated ${new Date(data.generatedAt).toLocaleString()}.`;
  timelineLabelNode.textContent = currentWindow.days
    ? `Recent history across the last ${currentWindow.days} days.`
    : "Most recent 18 monthly buckets.";

  renderStats(summary, data.commits);
  renderRankedList(
    subsystemNode,
    summary.subsystems,
    "No subsystem data for this window.",
    (item) => `${item.authors.size} authors • latest ${formatDate(item.latestAt)}`,
  );
  renderRankedList(
    agentNode,
    summary.agents,
    "No assistant identities found for this window.",
    (item) => (item.model ? `${item.name} • ${item.model}` : item.name),
  );
  renderTimeline(buildTimeline(commits, currentWindow));
  renderCommits(commits);
}

async function init() {
  const response = await fetch("./data/adoption.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("snapshot missing");
  }
  const data = await response.json();
  let currentWindow = WINDOWS[1];

  const rerender = () => {
    windowBar.innerHTML = "";
    for (const option of WINDOWS) {
      const button = document.createElement("button");
      button.textContent = option.label;
      if (option.key === currentWindow.key) button.classList.add("active");
      button.addEventListener("click", () => {
        currentWindow = option;
        rerender();
      });
      windowBar.appendChild(button);
    }
    render(data, currentWindow);
  };

  rerender();
}

init().catch(() => {
  generatedAtNode.textContent = "No snapshot available.";
  statsNode.innerHTML = `<div class="status">Unable to load adoption data.</div>`;
  subsystemNode.innerHTML = `<div class="status">Unable to load adoption data.</div>`;
  agentNode.innerHTML = `<div class="status">Unable to load adoption data.</div>`;
  timelineNode.innerHTML = `<div class="status">Unable to load adoption data.</div>`;
  commitsNode.innerHTML = `<div class="status">Unable to load adoption data.</div>`;
});
