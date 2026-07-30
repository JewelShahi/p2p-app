import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  theme: "darkblue",
};

const themeSlice = createSlice({
  name: "theme",
  initialState,

  reducers: {
    toggleTheme: (state) => {
      state.theme = state.theme === "darkblue" ? "lightgreen" : "darkblue";
    },
  },
});

export const { toggleTheme } = themeSlice.actions;

export default themeSlice.reducer;
