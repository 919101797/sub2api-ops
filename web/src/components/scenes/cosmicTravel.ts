import { spring } from 'motion'

/** Sample Motion inside the scene's existing loop; the moving lead keeps the journey evenly paced. */
export function createCosmicTravel(initial: number, duration = 8500) {
  let lead = initial
  let goal = initial
  const travel = {
    value: initial,
    velocity: 0,
    atRest: () => travel.value === goal && travel.velocity === 0 && lead === goal,
    step(target: number, delta: number) {
      goal = target
      if (travel.atRest()) return travel.value
      const oldLead = lead
      const distance = target - lead
      lead += Math.sign(distance) * Math.min(Math.abs(distance), delta / duration)
      const curve = spring({
        keyframes: [travel.value, (oldLead + lead) / 2],
        velocity: travel.velocity,
        stiffness: 64,
        damping: 16,
        restDelta: 0.000001,
        restSpeed: 0.00001,
      })
      const value = curve.next(delta).value
      const ahead = curve.next(delta + 0.1).value
      travel.velocity = (ahead - value) * 10_000
      travel.value = Math.max(0, Math.min(1, value))
      if (lead === target && Math.abs(travel.value - target) < 0.00005 && Math.abs(travel.velocity) < 0.0005) {
        travel.value = target
        travel.velocity = 0
      }
      return travel.value
    },
  }
  return travel
}
