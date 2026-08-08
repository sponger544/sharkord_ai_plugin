export type Actions = {
  ask: {
    payload: {
      channelId: number;
      question: string;
    };
    response: string;
  };
  resetHistory: {
    payload: { channelId: number };
    response: string;
  };
};
