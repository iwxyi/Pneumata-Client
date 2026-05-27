export const motion = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.16, 1, 0.3, 1)',
  softOut: 'cubic-bezier(0.22, 1, 0.36, 1)',
  softInOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  crispOut: 'cubic-bezier(0.18, 0.88, 0.32, 1)',
  press: 'cubic-bezier(0.3, 0, 0.8, 0.15)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  gentleSpring: 'cubic-bezier(0.2, 1.18, 0.34, 1)',
  durations: {
    instant: 120,
    fast: 160,
    base: 220,
    slow: 320,
    settle: 420,
  },
} as const;

export function transition(properties: string[], duration: number = motion.durations.base, easing: string = motion.standard) {
  return properties.map((property) => `${property} ${duration}ms ${easing}`).join(', ');
}
