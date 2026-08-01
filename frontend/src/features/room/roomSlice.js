import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  roomId: null,
  isHost: false,
  userId: null,
  expiresAt: null,
  peers: [],
};

const roomSlice = createSlice({
  name: 'room',
  initialState,
  reducers: {
    setRoom: (state, action) => {
      Object.assign(state, action.payload);
    },
    addPeer: (state, action) => {
      state.peers.push(action.payload);
    },
    removePeer: (state, action) => {
      state.peers = state.peers.filter((p) => p.socketId !== action.payload);
    },
    resetRoom: () => initialState,
  },
});

export const { setRoom, addPeer, removePeer, resetRoom } = roomSlice.actions;
export default roomSlice.reducer;