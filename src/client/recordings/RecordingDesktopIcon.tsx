import selectIcon from '../../../assets/recording-icons/record_func_selectmode.svg'
import searchIcon from '../../../assets/recording-icons/image_search_grey.svg'
import compareIcon from '../../../assets/recording-icons/transcription-compare-linear.svg'
import forwardIcon from '../../../assets/recording-icons/send-2-linear.svg'
import exitIcon from '../../../assets/recording-icons/close-circle-linear.svg'
import transcriptIcon from '../../../assets/recording-icons/icon_transcription.svg'
import summaryIcon from '../../../assets/recording-icons/icon_summary.svg'
import timelineIcon from '../../../assets/recording-icons/record_detail_time.svg'
import maximizeIcon from '../../../assets/recording-icons/icon_maximize.svg'
import minimizeIcon from '../../../assets/recording-icons/icon_minimize.svg'
import exportIcon from '../../../assets/recording-icons/record_selectmode_export.svg'

const icons = { select: selectIcon, search: searchIcon, compare: compareIcon, forward: forwardIcon, exit: exitIcon, transcript: transcriptIcon, summary: summaryIcon, timeline: timelineIcon, maximize: maximizeIcon, minimize: minimizeIcon, export: exportIcon }

export function RecordingDesktopIcon({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  const mask = `url(data:image/svg+xml;base64,${icons[name]})`
  return <span aria-hidden data-recording-desktop-icon={name} style={{
    display: 'inline-block', flex: 'none', width: size, height: size, backgroundColor: 'currentColor',
    maskImage: mask, WebkitMaskImage: mask, maskSize: 'contain', WebkitMaskSize: 'contain',
    maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center',
  }} />
}
