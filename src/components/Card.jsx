/**
 * Base white card. Pass `onClick` to make it a pressable tap target.
 */
export default function Card({ className = '', children, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`rounded-card border border-line bg-white shadow-card ${
        onClick ? 'pressable' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
