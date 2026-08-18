/** Session + persistence-free holder so store reconcile can see the last console cash override. */

let acceptedTestRemoteMoney: number | null = null;

export function getAcceptedTestRemoteMoney(): number | null {
  return acceptedTestRemoteMoney;
}

export function setAcceptedTestRemoteMoney(value: number | null): void {
  acceptedTestRemoteMoney = value;
}
