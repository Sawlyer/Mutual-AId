import { TooltipProvider } from '@/components/ui/tooltip'
import { router } from '@/app/router'
import { RouterProvider } from 'react-router'

export default function App() {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  )
}
