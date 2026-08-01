import axios from 'axios';
import toast from 'react-hot-toast';
import { API_URL } from '../constants/config';
import { getClientId } from '../utils/clientId';

const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  config.headers['X-Client-Id'] = getClientId();
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (!err.response) {
      toast.error('Network error — check your connection');
    } else if (err.response.status === 429) {
      toast.error(err.response.data?.error || "You're doing that too much — slow down and try again shortly");
    } else {
      toast.error(err.response.data?.error || 'Something went wrong');
    }
    return Promise.reject(err);
  }
);

export default api;