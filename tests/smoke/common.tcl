if {[info exists env(AUTOLABOS_SMOKE_VERBOSE)] && $env(AUTOLABOS_SMOKE_VERBOSE) ne ""} {
  log_user 1
} else {
  log_user 0
}

proc fail {message} {
  global expect_out
  puts $message
  if {[info exists expect_out(buffer)] && $expect_out(buffer) ne ""} {
    puts "---- recent expect buffer ----"
    puts $expect_out(buffer)
    puts "------------------------------"
  }
  exit 1
}

proc escape_regex {text} {
  return [string map {\\ \\\\ [ \\[ ] \\] ( \\( ) \\) . \\. + \\+ * \\* ? \\? ^ \\^ $ \\$ | \\|} $text]
}

proc spawn_autolabos {workdir} {
  global spawn_id
  set repo_root [file normalize [file join [file dirname [info script]] ../..]]
  cd $workdir
  spawn env COLUMNS=220 LINES=40 node [file join $repo_root dist cli main.js]
  catch {stty rows 40 cols 220}
}
