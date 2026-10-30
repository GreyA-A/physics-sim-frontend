import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Яскевич В. О. [[1]], с. 9-10 (елементи та рендеринг): створюємо корінь React
// і рендеримо в нього елемент <App />. createRoot - API React 18.
const container = document.getElementById('root');

// Захист: без кореневого елемента монтування неможливе, тому зупиняємося з явною помилкою
if (!container) {
  throw new Error('Кореневий елемент #root не знайдено в index.html');
}

createRoot(container).render(
  // StrictMode у режимі розробки виявляє небезпечні побічні ефекти
  <StrictMode>
    <App />
  </StrictMode>,
);