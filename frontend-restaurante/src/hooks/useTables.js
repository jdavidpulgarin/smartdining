import { useContext } from 'react'
import { TablesContext } from '../context/tablesContextDef'

export function useTables() {
  const ctx = useContext(TablesContext)
  return ctx
}
