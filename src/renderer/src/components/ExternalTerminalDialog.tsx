import { Command, TerminalSquare } from 'lucide-react'
import type { ExternalTerminalShell, Project } from '@shared/types'
import Modal from './Modal'

interface Props {
  project: Project
  onClose: () => void
  onChoose: (shell: ExternalTerminalShell) => void
}

const choices: Array<{
  id: ExternalTerminalShell
  label: string
  detail: string
  icon: typeof Command
}> = [
  {
    id: 'cmd',
    label: 'Command Prompt',
    detail: 'Open cmd.exe in this project folder.',
    icon: Command
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    detail: 'Open PowerShell in this project folder.',
    icon: TerminalSquare
  }
]

export default function ExternalTerminalDialog({
  project,
  onClose,
  onChoose
}: Props): React.JSX.Element {
  return (
    <Modal
      title="Open external terminal"
      subtitle={`Choose a shell for ${project.name}.`}
      onClose={onClose}
      width={430}
    >
      <div className="external-terminal-options">
        {choices.map(({ id, label, detail, icon: Icon }) => (
          <button key={id} className="external-terminal-option" onClick={() => onChoose(id)}>
            <Icon size={19} />
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  )
}
