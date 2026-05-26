export default function Home() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <p className="text-slate-300">Cycle status overview lands in Task 10.</p>
      <ul className="list-disc list-inside text-sm text-slate-400">
        <li>
          <a href="/live" className="text-blue-400 hover:underline">Live monitor</a>
        </li>
        <li>
          <a href="/virtual-plc" className="text-blue-400 hover:underline">Virtual PLC control panel</a>
        </li>
      </ul>
    </div>
  );
}
