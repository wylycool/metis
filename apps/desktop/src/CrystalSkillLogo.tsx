import crystalLogoUrl from "./assets/metis-crystal-logo.svg";

type CrystalSkillLogoProps = {
  testId: string;
};

export function CrystalSkillLogo({ testId }: CrystalSkillLogoProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className="metis-crystal-logo"
      data-testid={testId}
      draggable="false"
      src={crystalLogoUrl}
    />
  );
}
