import { configureStore } from '@reduxjs/toolkit';
import themeReducer from '../features/theme/themeSlice';
import roomReducer from '../features/room/roomSlice';

const store = configureStore({
  reducer: {
    theme: themeReducer,
    room: roomReducer,
  },
});

export default store;