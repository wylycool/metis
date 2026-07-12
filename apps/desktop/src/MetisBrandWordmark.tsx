type MetisBrandWordmarkProps = {
  testId: string;
};

export function MetisBrandWordmark({ testId }: MetisBrandWordmarkProps) {
  return (
    <strong className="metis-brand-wordmark" data-testid={testId}>
      <span className="metis-brand-wordmark-base">Met</span>
      <span className="metis-brand-wordmark-i">i</span>
      <span className="metis-brand-wordmark-s">s</span>
    </strong>
  );
}
