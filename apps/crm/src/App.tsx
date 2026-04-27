import { Routes, Route } from "react-router-dom";
import HelloPage from "./pages/HelloPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HelloPage />} />
    </Routes>
  );
}
