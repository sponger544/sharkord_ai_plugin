export type Commands = {
  ask: {
    args: { question: string };
    response: string;
  };
  reset: {
    args: Record<string, never>;
    response: string;
  };
};
