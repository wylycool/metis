import { useState } from "react";

function App() {
  const [greeting, setGreeting] = useState("");

  return (
    <div className="container">
      <header>
        <h1>Metis</h1>
        <p className="subtitle">Agent Skill Manager</p>
      </header>

      <main>
        <div className="card">
          <h2>Phase 1 — Core Engine</h2>
          <p>本地 skill 扫描、来源绑定、更新检测、备份回滚</p>
          <button onClick={() => setGreeting("Hello from Metis! 🦉")}>
            测试 Tauri 桥接
          </button>
          {greeting && <p className="greeting">{greeting}</p>}
        </div>

        <div className="status">
          <p>状态：骨架搭建完成，等待 Core Engine API 实现</p>
        </div>
      </main>

      <footer>
        <p>Metis v0.1.0 · MIT License</p>
      </footer>
    </div>
  );
}

export default App;
