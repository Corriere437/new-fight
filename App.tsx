import React from 'react';
import CombatGame from './components/CombatGame';

const App: React.FC = () => {
  return (
    <div className="relative w-full h-screen bg-slate-900 overflow-hidden flex flex-col items-center justify-center">
      <CombatGame />
    </div>
  );
};

export default App;