import { useEffect, useMemo, useRef, useState } from "react";
import { listAgents, listIndexedSkills, scanSkills } from "./api";
import type { DesktopAgentStatus, DesktopScanWarning, DesktopSkill, LoadState } from "./types";

function App() {
  const [agents, setAgents] = useState<DesktopAgentStatus[]>([]);
  const [skills, setSkills] = useState<DesktopSkill[]>([]);
  const [warnings, setWarnings] = useState<DesktopScanWarning[]>([]);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const didBootstrap = useRef(false);

  const groupedSkills = useMemo(() => {
    return agents.map((agent) => ({
      ...agent,
      skills: skills.filter((skill) => skill.agent_id === agent.agent_id),
    }));
  }, [agents, skills]);

  const totalExistingPaths = agents.reduce(
    (count, agent) => count + agent.paths.filter((path) => path.exists).length,
    0,
  );
  const modifiedCount = skills.filter((skill) => skill.local_modified).length;

  useEffect(() => {
    if (didBootstrap.current) {
      return;
    }
    didBootstrap.current = true;
    void bootstrap();
  }, []);

  async function bootstrap() {
    setState("loading");
    setError(null);

    try {
      const [agentResult, indexedResult] = await Promise.all([
        listAgents(),
        listIndexedSkills(),
      ]);
      setAgents(agentResult);

      if (indexedResult.length > 0) {
        setSkills(indexedResult);
        setWarnings([]);
        setState("loaded");
        return;
      }

      const scanResult = await scanSkills();
      setSkills(scanResult.skills);
      setWarnings(scanResult.warnings);
      setState("loaded");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("error");
    }
  }

  async function handleScan() {
    setState("loading");
    setError(null);

    try {
      const [agentResult, scanResult] = await Promise.all([listAgents(), scanSkills()]);
      setAgents(agentResult);
      setSkills(scanResult.skills);
      setWarnings(scanResult.warnings);
      setState("loaded");
    } catch (caught) {
      setError(errorMessage(caught));
      setState("error");
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Metis Desktop MVP</p>
          <h1>本机 Skills</h1>
        </div>
        <button className="scan-button" disabled={state === "loading"} onClick={handleScan}>
          {state === "loading" ? "扫描中" : "重新扫描"}
        </button>
      </header>

      <section className="summary-strip" aria-label="扫描摘要">
        <SummaryMetric label="已发现 skills" value={skills.length.toString()} />
        <SummaryMetric label="已启用 Agent" value={agents.length.toString()} />
        <SummaryMetric label="存在的路径" value={totalExistingPaths.toString()} />
        <SummaryMetric label="本地修改" value={modifiedCount.toString()} />
      </section>

      <main className="workspace">
        <aside className="agent-rail" aria-label="Agent 分组">
          <div className="rail-heading">
            <span>Agent</span>
            <strong>{agents.length}</strong>
          </div>
          <div className="agent-list">
            {groupedSkills.map((agent) => (
              <div className="agent-row" key={agent.agent_id}>
                <div>
                  <strong>{agent.agent_name}</strong>
                  <span>{agent.agent_id}</span>
                </div>
                <b>{agent.skills.length}</b>
              </div>
            ))}
          </div>
        </aside>

        <section className="skill-panel">
          <div className="panel-heading">
            <div>
              <h2>Skill 索引</h2>
              <p>{statusText(state, skills.length)}</p>
            </div>
            {warnings.length > 0 && (
              <span className="warning-pill">{warnings.length} 条 warning</span>
            )}
          </div>

          {state === "loading" && <LoadingState />}
          {state === "error" && <ErrorState message={error} onRetry={handleScan} />}
          {state === "loaded" && skills.length === 0 && <EmptyState onScan={handleScan} />}
          {state === "loaded" && skills.length > 0 && (
            <div className="skill-list">
              {skills.map((skill) => (
                <SkillRow key={skill.id} skill={skill} />
              ))}
            </div>
          )}
        </section>
      </main>

      {warnings.length > 0 && (
        <section className="warning-panel" aria-label="扫描警告">
          <h2>扫描警告</h2>
          {warnings.map((warning) => (
            <div className="warning-row" key={`${warning.agent_id}-${warning.path}-${warning.message}`}>
              <strong>{warning.agent_id}</strong>
              <span>{warning.message}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SkillRow({ skill }: { skill: DesktopSkill }) {
  return (
    <article className="skill-row">
      <div className="skill-main">
        <div className="skill-title">
          <h3>{skill.name}</h3>
          <span>{skill.agent_name}</span>
        </div>
        {skill.description && <p>{skill.description}</p>}
        <code>{skill.install_path}</code>
      </div>
      <div className="skill-status">
        <StatusBadge tone={metadataTone(skill.metadata_status)}>
          metadata: {metadataLabel(skill.metadata_status)}
        </StatusBadge>
        <StatusBadge tone={skill.local_modified ? "danger" : "muted"}>
          {localModifiedLabel(skill.local_modified)}
        </StatusBadge>
      </div>
    </article>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "danger" | "muted";
}) {
  return <span className={`status-badge ${tone}`}>{children}</span>;
}

function LoadingState() {
  return (
    <div className="state-block">
      <div className="loader" />
      <p>正在读取本地索引并扫描默认 skill 目录</p>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <div className="state-block error-state">
      <h3>扫描失败</h3>
      <p>{message ?? "未知错误"}</p>
      <button onClick={onRetry}>重试扫描</button>
    </div>
  );
}

function EmptyState({ onScan }: { onScan: () => void }) {
  return (
    <div className="state-block">
      <h3>还没有发现 skills</h3>
      <p>默认目录中暂时没有可索引的 `SKILL.md`。</p>
      <button onClick={onScan}>重新扫描</button>
    </div>
  );
}

function statusText(state: LoadState, count: number) {
  if (state === "loading") {
    return "正在同步 Core discovery 与 SQLite 索引";
  }
  if (state === "error") {
    return "请查看错误信息后重试";
  }
  if (count === 0) {
    return "默认目录暂无已发现 skill";
  }
  return "来自本机 SQLite 索引和最新扫描结果";
}

function metadataTone(status: string) {
  return status === "found" ? "good" : "danger";
}

function metadataLabel(status: string) {
  if (status === "found") {
    return "found";
  }
  if (status === "parse_error") {
    return "parse error";
  }
  return status;
}

function localModifiedLabel(value: boolean | null | undefined) {
  if (value === true) {
    return "本地已修改";
  }
  if (value === false) {
    return "未发现修改";
  }
  return "未检测修改";
}

function errorMessage(caught: unknown) {
  if (caught instanceof Error) {
    return caught.message;
  }
  if (typeof caught === "string") {
    return caught;
  }
  return "桌面后端返回了无法识别的错误";
}

export default App;
